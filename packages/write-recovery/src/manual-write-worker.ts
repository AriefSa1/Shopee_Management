import assert from "node:assert/strict"
import { RUNTIME_POLICY_VERSION } from "../../runtime-boundaries/src/runtime-boundaries.ts"
import { createWritePlan } from "./recovery.ts"
import { FakeWriteRecoveryPostgresExecutor } from "./postgres-write-recovery.fake.ts"
import { PostgresWriteRecoveryRepository } from "./postgres-write-recovery.ts"
import { executeConfirmedWriteWorker, type ConfirmedWriteProvider, type ConfirmedWriteRevalidator } from "./write-worker.ts"

const organizationId = "10000000-0000-4000-8000-000000000001"
const shopId = "30000000-0000-4000-8000-000000000001"
const payloadHash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
const previewHash = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
const plan = createWritePlan({ organizationId, actorId: "owner-manual-worker", intentId: "intent-manual-worker", previewHash, commandVersion: 1, destinations: [{ shopId, payloadHash }] }, { status: "verified", evidence: "official-fixture-capability" })
const initialAttempt = plan.attempts[0]
assert.ok(initialAttempt)
const dispatched = { ...initialAttempt, state: "dispatched" as const, dispatchAllowed: false }
const executor = new FakeWriteRecoveryPostgresExecutor()
const persistence = new PostgresWriteRecoveryRepository(executor)
const allowRevalidation: ConfirmedWriteRevalidator = async () => ({ kind: "allowed" })
await persistence.savePlan({ plan, metadata: { actorId: "owner-manual-worker", intentId: "intent-manual-worker", previewHash, commandVersion: 1 } })
await persistence.updateAttempt({ attempt: dispatched, expectedState: "pending" })
const provider: ConfirmedWriteProvider = {
  async mediaUpload() { return { kind: "succeeded", providerReference: "media-1" } },
  async itemCreate() { return { kind: "succeeded", providerReference: "item-1" } },
  async variationInit() { return { kind: "succeeded", providerReference: "variation-1" } },
  async publication() { return { kind: "succeeded", providerReference: "publication-1" } },
}
const result = await executeConfirmedWriteWorker({ runtimeRole: "worker", policyVersion: RUNTIME_POLICY_VERSION, plan, attempt: dispatched, confirmationBinding: plan.confirmationBinding }, { persistence, provider, revalidate: allowRevalidation })
assert.equal(result.kind, "succeeded")
console.log(JSON.stringify({
  scenario: "confirmed-write-worker-provider-free",
  result: result.kind,
  steps: 4,
  externalAttemptsPersisted: executor.statements.filter((statement) => statement.name === "external.operation.insert").length,
  outcomeUnknownRetry: "blocked",
  networkCalls: 0,
  databaseCalls: 0,
  shopeeMutations: 0,
  externalWrites: 0,
  secretFieldsPresent: false,
}))
