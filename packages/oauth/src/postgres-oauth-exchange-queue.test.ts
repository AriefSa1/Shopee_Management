import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import type {
  PostgresExecutor,
  SqlRow,
  SqlStatement,
} from "../../delivery/src/postgres-delivery.ts"
import { OrganizationIdSchema } from "../../identity/src/model.ts"
import { PostgresOAuthExchangeQueue } from "./postgres-oauth-exchange-queue.ts"

const organizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
const attemptId = "20000000-0000-4000-8000-000000000001"

class FakeExecutor implements PostgresExecutor {
  readonly statements: SqlStatement[] = []
  status = "pending"
  leaseOwner: string | undefined

  async query(statement: SqlStatement): Promise<readonly SqlRow[]> {
    this.statements.push(statement)
    if (statement.name === "oauth.exchange.lease.select") {
      if (this.status === "completed" || this.status === "failed") return []
      return [
        {
          organization_id: organizationId,
          attempt_id: attemptId,
          state_hash: "state-queue-000000000000000000000000000001",
          partner_application_id: "partner-queue",
          market: "ID",
          shop_id: "1819834906",
          issued_at: "2026-09-10T00:00:00.000Z",
          expires_at: "2026-09-10T01:00:00.000Z",
          actor_issuer: "https://issuer.example.test",
          actor_subject: "queue-owner",
          envelope_algorithm: "kms-envelope-v1",
          envelope_key_version: 7,
          envelope_ciphertext: "sealed-code",
        },
      ]
    }
    if (statement.name === "oauth.exchange.lease.claim") {
      this.status = "processing"
      this.leaseOwner = String(statement.params[2])
      return [{ attempt_id: attemptId }]
    }
    if (
      statement.name === "oauth.exchange.lease.complete" ||
      statement.name === "oauth.exchange.lease.fail"
    ) {
      if (this.status !== "processing" || this.leaseOwner !== String(statement.params[2])) return []
      this.status = statement.name.endsWith("fail") ? "failed" : "completed"
      return [{ attempt_id: attemptId }]
    }
    throw new Error(`Unhandled statement ${statement.name}`)
  }

  async transaction<T>(work: (executor: PostgresExecutor) => Promise<T>): Promise<T> {
    const child = new FakeExecutor()
    child.status = this.status
    child.leaseOwner = this.leaseOwner
    const result = await work(child)
    this.status = child.status
    this.leaseOwner = child.leaseOwner
    this.statements.push(...child.statements)
    return result
  }
}

describe("PostgreSQL OAuth exchange queue", () => {
  it("claims a pending handoff with a lease and completes it with the same worker", async () => {
    // Given: a pending durable handoff.
    const executor = new FakeExecutor()
    const queue = new PostgresOAuthExchangeQueue(executor)

    // When: a worker claims and completes the next handoff.
    const lease = await queue.claimNext({
      workerId: "worker-a",
      now: "2026-09-10T00:00:00.000Z",
      leaseSeconds: 60,
    })
    assert.ok(lease)
    await queue.complete(lease)

    // Then: the lease is scoped to the worker and the command is terminal.
    assert.equal(executor.status, "completed")
    assert.equal(lease.handoff.envelope.ciphertext, "sealed-code")
  })

  it("rejects completion by a different worker", async () => {
    // Given: a handoff leased by worker-a.
    const executor = new FakeExecutor()
    const queue = new PostgresOAuthExchangeQueue(executor)
    const lease = await queue.claimNext({
      workerId: "worker-a",
      now: "2026-09-10T00:00:00.000Z",
      leaseSeconds: 60,
    })
    assert.ok(lease)

    // When: worker-b attempts to complete it.
    await assert.rejects(
      queue.complete({ organizationId, attemptId: lease.attemptId, workerId: "worker-b" }),
      /OAuth exchange lease operation failed/,
    )

    // Then: the original lease remains processing.
    assert.equal(executor.status, "processing")
  })

  it("reclaims an expired processing lease", async () => {
    // Given: a queue implementation that exposes an expired processing row.
    const executor = new FakeExecutor()
    executor.status = "processing"
    executor.leaseOwner = "worker-old"
    const queue = new PostgresOAuthExchangeQueue(executor)

    // When: another worker claims after the lease expiry.
    const lease = await queue.claimNext({
      workerId: "worker-new",
      now: "2026-09-10T00:02:00.000Z",
      leaseSeconds: 60,
    })

    // Then: the new worker owns the replacement lease.
    assert.equal(lease?.workerId, "worker-new")
    assert.equal(executor.leaseOwner, "worker-new")
  })

  it("keeps lease states and failure reasons explicit in the migration", () => {
    const migration = readFileSync("db/migrations/0014_oauth_exchange_leases.sql", "utf8")
    assert.match(migration, /status IN \('pending', 'processing', 'completed', 'failed'\)/)
    assert.match(migration, /lease_expires_at/)
    assert.match(migration, /failure_reason/)
    assert.match(migration, /oauth_exchange_commands_claim_idx/)
  })
})
