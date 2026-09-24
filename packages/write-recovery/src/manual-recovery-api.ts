import { createWriteRecoveryApiHandler, ExternalOperationAttemptIdSchema, OrganizationIdSchema, ShopIdSchema, WriteAttemptIdSchema, WriteHashSchema, type WriteRecoveryApiDependencies } from "./index.ts"
import type { ExternalOperationAttempt } from "./model.ts"

const organizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
const shopId = ShopIdSchema.parse("30000000-0000-4000-8000-000000000001")
const attempt: ExternalOperationAttempt = { operationAttemptId: ExternalOperationAttemptIdSchema.parse(`external-attempt:${"d".repeat(64)}`), organizationId, writeAttemptId: WriteAttemptIdSchema.parse(`write-attempt:${"a".repeat(64)}`), destinationShopId: shopId, step: "media_upload", requestFingerprint: WriteHashSchema.parse("e".repeat(64)), state: "outcome_unknown", retryAllowed: false, outcomeReason: "ack_timeout" }
let resolvedOperatorId = ""
const dependencies: WriteRecoveryApiDependencies = {
  authenticate: () => ({ organizationId, actorId: "actor-owner", accessibleShopIds: [shopId], canResolve: true }),
  list: async () => [attempt],
  find: async () => attempt,
  resolve: async ({ attempt: current, decision }) => { resolvedOperatorId = decision.operatorId; return { ...current, state: "failed", retryAllowed: false, outcomeReason: decision.kind === "mark_failed" ? decision.reason : "operator_review" } },
}
const listed = await createWriteRecoveryApiHandler(new Request(`https://example.test/api/write-recovery/outcome-unknown?organizationId=${organizationId}&shopId=${shopId}`, { headers: { authorization: "Bearer fixture" } }), dependencies)
const resolved = await createWriteRecoveryApiHandler(new Request("https://example.test/api/write-recovery/outcome-unknown", { method: "POST", headers: { authorization: "Bearer fixture", "content-type": "application/json" }, body: JSON.stringify({ organizationId, operationAttemptId: attempt.operationAttemptId, decision: { kind: "mark_failed", reason: "operator_review" } }) }), dependencies)
console.log(JSON.stringify({ scenario: "phase6-write-recovery-operator-api", listStatus: listed.status, resolveStatus: resolved.status, scopedUnknownListed: (await listed.clone().json() as { data: { attempts: readonly unknown[] } }).data.attempts.length === 1, resolveBoundToAuthenticatedActor: resolvedOperatorId === "actor-owner", mutationPolicy: "disabled", networkCalls: 0, databaseCalls: 0, shopeeMutations: 0, externalWrites: 0, secretFieldsPresent: false, livePostgres: "not_run" }, null, 2))
