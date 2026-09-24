import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import type {
  PostgresExecutor,
  SqlRow,
  SqlStatement,
} from "../../delivery/src/postgres-delivery.ts"
import type { KmsEnvelopeCodec } from "./durable-contracts.ts"
import { CallbackCodeSchema, OAuthCallbackInputSchema } from "./model.ts"
import { PostgresOAuthCallbackHandoff } from "./postgres-oauth-callback-handoff.ts"

const organizationId = "10000000-0000-4000-8000-000000000001"
const stateHash = "state-handoff-000000000000000000000000000001"
const attemptId = "20000000-0000-4000-8000-000000000001"
const callback = OAuthCallbackInputSchema.parse({
  stateHash,
  organizationId,
  actor: { issuer: "https://issuer.example", subject: "owner-1" },
  receivedAt: "2026-09-10T00:00:00.000Z",
  code: "raw-callback-code",
  shopId: "1819834906",
})

class FakeExecutor implements PostgresExecutor {
  readonly statements: SqlStatement[] = []
  stateStatus = "issued"
  command: { readonly commandId: string; readonly eventId: string } | undefined

  async query(statement: SqlStatement): Promise<readonly SqlRow[]> {
    this.statements.push(statement)
    if (statement.name === "oauth.exchange.state.lock") {
      if (this.stateStatus === "missing") return []
      return [
        {
          organization_id: organizationId,
          state_hash: stateHash,
          attempt_id: attemptId,
          actor_issuer: "https://issuer.example",
          actor_subject: "owner-1",
          partner_application_id: "partner-live",
          market: "ID",
          issued_at: "2026-09-10T00:00:00.000Z",
          expires_at: "2026-09-10T01:00:00.000Z",
          status: this.stateStatus,
        },
      ]
    }
    if (statement.name === "oauth.exchange.command.read") {
      return this.command === undefined
        ? []
        : [{ command_id: this.command.commandId, event_id: this.command.eventId }]
    }
    if (statement.name === "oauth.exchange.envelope.insert") return []
    if (statement.name === "oauth.exchange.command.insert") {
      this.command = {
        commandId: String(statement.params[1]),
        eventId: "50000000-0000-4000-8000-000000000001",
      }
      return []
    }
    if (statement.name === "oauth.exchange.outbox.insert") {
      this.command = {
        commandId: String(statement.params[5]),
        eventId: String(statement.params[1]),
      }
      return []
    }
    if (statement.name === "oauth.exchange.state.claim") {
      this.stateStatus = "claimed"
      return []
    }
    if (statement.name === "oauth.exchange.command.attempt") return []
    throw new Error(`Unhandled statement ${statement.name}`)
  }

  async transaction<T>(work: (executor: PostgresExecutor) => Promise<T>): Promise<T> {
    const child = new FakeExecutor()
    child.stateStatus = this.stateStatus
    child.command = this.command
    try {
      const result = await work(child)
      this.stateStatus = child.stateStatus
      this.command = child.command
      this.statements.push(...child.statements)
      return result
    } catch (error) {
      this.statements.push(...child.statements)
      throw error
    }
  }
}

function kms(shouldFail = false): KmsEnvelopeCodec {
  return {
    async seal() {
      if (shouldFail) throw new Error("kms unavailable")
      return { keyVersion: 7, ciphertext: "sealed-code", algorithm: "kms-envelope-v1" }
    },
    async unseal(envelope) {
      return CallbackCodeSchema.parse(envelope.ciphertext)
    },
  }
}

describe("PostgreSQL OAuth callback handoff", () => {
  it("persists one encrypted handoff and one secret-free outbox event", async () => {
    // Given: an issued state and a worker-only KMS seal boundary.
    const executor = new FakeExecutor()
    const repository = new PostgresOAuthCallbackHandoff(executor, kms(), {
      keyVersion: 7,
      nextIds: () => ({
        commandId: "40000000-0000-4000-8000-000000000001",
        eventId: "50000000-0000-4000-8000-000000000001",
      }),
    })

    // When: the callback is accepted.
    const result = await repository.accept(callback)

    // Then: the handoff is accepted once and no ordinary delivery statement contains the raw code.
    assert.equal(result.kind, "accepted")
    assert.equal(
      executor.statements.filter((statement) => statement.name === "oauth.exchange.command.insert")
        .length,
      1,
    )
    assert.equal(
      executor.statements.filter((statement) => statement.name === "oauth.exchange.outbox.insert")
        .length,
      1,
    )
    const deliveryStatements = executor.statements.filter(
      (statement) => statement.name !== "oauth.exchange.envelope.insert",
    )
    assert.equal(
      deliveryStatements.flatMap((statement) => statement.params).includes("raw-callback-code"),
      false,
    )
  })

  it("returns the existing handoff for a replay without a second outbox", async () => {
    // Given: a callback already accepted into a durable command.
    const executor = new FakeExecutor()
    const repository = new PostgresOAuthCallbackHandoff(executor, kms(), {
      keyVersion: 7,
      nextIds: (() => {
        let count = 0
        return () => {
          count += 1
          return {
            commandId: `40000000-0000-4000-8000-00000000000${count}`,
            eventId: `50000000-0000-4000-8000-00000000000${count}`,
          }
        }
      })(),
    })
    await repository.accept(callback)

    // When: the same callback is presented again.
    const replay = await repository.accept(callback)

    // Then: the existing command is returned and only one insert exists.
    assert.equal(replay.kind, "duplicate")
    assert.equal(
      executor.statements.filter((statement) => statement.name === "oauth.exchange.command.insert")
        .length,
      1,
    )
    assert.equal(
      executor.statements.filter((statement) => statement.name === "oauth.exchange.outbox.insert")
        .length,
      1,
    )
  })

  it("does not claim state when KMS sealing fails", async () => {
    // Given: a KMS boundary that cannot seal callback material.
    const executor = new FakeExecutor()
    const repository = new PostgresOAuthCallbackHandoff(executor, kms(true), {
      keyVersion: 7,
      nextIds: () => ({
        commandId: "40000000-0000-4000-8000-000000000001",
        eventId: "50000000-0000-4000-8000-000000000001",
      }),
    })

    // When: accepting the callback fails during sealing.
    await assert.rejects(repository.accept(callback), /kms unavailable/)

    // Then: transaction rollback leaves the state issued and creates no delivery rows.
    assert.equal(executor.stateStatus, "issued")
    assert.equal(
      executor.statements.some((statement) => statement.name === "oauth.exchange.outbox.insert"),
      false,
    )
  })

  it("keeps the durable handoff migration secret-safe and relationally linked", () => {
    const migration = readFileSync("db/migrations/0013_oauth_callback_handoff.sql", "utf8")
    assert.match(migration, /actor_subject/)
    assert.match(migration, /envelope_ciphertext/)
    assert.match(migration, /REFERENCES delivery_commands/)
    assert.match(migration, /REFERENCES outbox_events/)
    assert.doesNotMatch(migration, /callback_code|access_token|refresh_token|authorization_header/)
    const shopMigration = readFileSync("db/migrations/0015_oauth_shop_id.sql", "utf8")
    assert.match(shopMigration, /shop_id text/)
    assert.match(shopMigration, /shop_id IS NULL OR shop_id ~ '\^\[1-9\]\[0-9\]\*\$'/)
  })
})
