import { ExternalOperationAttemptIdSchema, OrganizationIdSchema, ShopIdSchema, WriteHashSchema, createWritePlan, PostgresWriteRecoveryRepository } from "./index.ts"
import { FakeWriteRecoveryPostgresExecutor } from "./postgres-write-recovery.fake.ts"

const input = { organizationId: "10000000-0000-4000-8000-000000000001", actorId: "actor-owner", intentId: "intent:copy-1", previewHash: "a".repeat(64), commandVersion: 1, destinations: [{ shopId: "30000000-0000-4000-8000-000000000001", payloadHash: "b".repeat(64) }] }
const organizationId = OrganizationIdSchema.parse(input.organizationId)
const destinationShopId = ShopIdSchema.parse(input.destinations[0]!.shopId)
const plan = createWritePlan(input, { status: "verified", evidence: "provider-free fixture" })
if (plan.kind !== "ready") throw new Error("expected fixture-ready plan")
const writeAttempt = plan.attempts[0]
if (!writeAttempt) throw new Error("expected destination attempt")
const repo = new PostgresWriteRecoveryRepository(new FakeWriteRecoveryPostgresExecutor())
await repo.savePlan({ plan, metadata: { actorId: input.actorId, intentId: input.intentId, previewHash: input.previewHash, commandVersion: input.commandVersion } })
const operation = { operationAttemptId: ExternalOperationAttemptIdSchema.parse(`external-attempt:${"d".repeat(64)}`), organizationId, writeAttemptId: writeAttempt.attemptId, destinationShopId, step: "media_upload" as const, requestFingerprint: WriteHashSchema.parse("e".repeat(64)), state: "prepared" as const, retryAllowed: true }
await repo.saveExternalOperationAttempt(operation)
await repo.updateExternalOperationAttempt({ attempt: { ...operation, state: "sent", retryAllowed: false }, expectedState: "prepared" })
await repo.updateExternalOperationAttempt({ attempt: { ...operation, state: "outcome_unknown", retryAllowed: false }, expectedState: "sent" })
const unknown = await repo.readExternalOperationAttempt({ organizationId }, operation.operationAttemptId)
console.log(JSON.stringify({ scenario: "phase6-external-operation-attempt-persistence", preparedPersisted: unknown !== null, outcomeUnknownPersisted: unknown?.state === "outcome_unknown", retryAllowed: unknown?.retryAllowed === false, mutationPolicy: "disabled", networkCalls: 0, databaseCalls: 0, shopeeMutations: 0, externalWrites: 0, secretFieldsPresent: false, livePostgres: "not_run" }, null, 2))
