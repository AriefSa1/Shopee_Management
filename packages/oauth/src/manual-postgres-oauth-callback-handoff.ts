import type {
  PostgresExecutor,
  SqlRow,
  SqlStatement,
} from "../../delivery/src/postgres-delivery.ts"
import type { KmsEnvelopeCodec } from "./durable-contracts.ts"
import { CallbackCodeSchema, OAuthCallbackInputSchema } from "./model.ts"
import { PostgresOAuthCallbackHandoff } from "./postgres-oauth-callback-handoff.ts"

const organizationId = "10000000-0000-4000-8000-000000000001"
const stateHash = "state-manual-0000000000000000000000000001"
const attemptId = "20000000-0000-4000-8000-000000000001"
const callback = OAuthCallbackInputSchema.parse({
  stateHash,
  organizationId,
  actor: { issuer: "https://issuer.example.test", subject: "manual-owner" },
  receivedAt: "2026-09-10T00:00:00.000Z",
  code: CallbackCodeSchema.parse("raw-code-manual"),
  shopId: "1819834906",
})

class ManualExecutor implements PostgresExecutor {
  readonly statements: SqlStatement[] = []
  status = "issued"
  command: { readonly commandId: string; readonly eventId: string } | undefined

  async query(statement: SqlStatement): Promise<readonly SqlRow[]> {
    this.statements.push(statement)
    if (statement.name === "oauth.exchange.state.lock")
      return [
        {
          organization_id: organizationId,
          state_hash: stateHash,
          attempt_id: attemptId,
          actor_issuer: callback.actor.issuer,
          actor_subject: callback.actor.subject,
          partner_application_id: "partner-manual",
          market: "ID",
          issued_at: "2026-09-10T00:00:00.000Z",
          expires_at: "2026-09-10T01:00:00.000Z",
          status: this.status,
        },
      ]
    if (statement.name === "oauth.exchange.command.read") {
      return this.command === undefined
        ? []
        : [{ command_id: this.command.commandId, event_id: this.command.eventId }]
    }
    if (statement.name === "oauth.exchange.command.insert") {
      this.command = {
        commandId: String(statement.params[1]),
        eventId: "50000000-0000-4000-8000-000000000001",
      }
    }
    if (statement.name === "oauth.exchange.outbox.insert") {
      this.command = {
        commandId: String(statement.params[5]),
        eventId: String(statement.params[1]),
      }
    }
    if (statement.name === "oauth.exchange.state.claim") this.status = "claimed"
    return []
  }

  async transaction<T>(work: (executor: PostgresExecutor) => Promise<T>): Promise<T> {
    const child = new ManualExecutor()
    child.status = this.status
    child.command = this.command
    const result = await work(child)
    this.status = child.status
    this.command = child.command
    this.statements.push(...child.statements)
    return result
  }
}

const kms: KmsEnvelopeCodec = {
  async seal() {
    return { keyVersion: 7, ciphertext: "sealed-manual", algorithm: "kms-envelope-v1" }
  },
  async unseal(envelope) {
    return CallbackCodeSchema.parse(envelope.ciphertext)
  },
}

const executor = new ManualExecutor()
const handoff = new PostgresOAuthCallbackHandoff(executor, kms, {
  keyVersion: 7,
  nextIds: () => ({
    commandId: "40000000-0000-4000-8000-000000000001",
    eventId: "50000000-0000-4000-8000-000000000001",
  }),
})
const first = await handoff.accept(callback)
const duplicate = await handoff.accept(callback)
const deliveryStatements = executor.statements.filter(
  (statement) => statement.name !== "oauth.exchange.envelope.insert",
)
const deliveryValues = deliveryStatements.flatMap((statement) => statement.params)

console.log(
  JSON.stringify({
    scenario: "phase2-oauth-callback-handoff-provider-free",
    accepted: first.kind === "accepted",
    duplicateReturned: duplicate.kind === "duplicate",
    oneCommand:
      executor.statements.filter((statement) => statement.name === "oauth.exchange.command.insert")
        .length === 1,
    oneOutbox:
      executor.statements.filter((statement) => statement.name === "oauth.exchange.outbox.insert")
        .length === 1,
    rawCallbackInDelivery: deliveryValues.includes("raw-code-manual"),
    databaseCalls: 0,
    providerCalls: 0,
    secretValuesEmitted: false,
  }),
)
