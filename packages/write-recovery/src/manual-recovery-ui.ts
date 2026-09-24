import assert from "node:assert/strict"
import {
  ExternalOperationAttemptIdSchema,
  OrganizationIdSchema,
  ShopIdSchema,
  WriteAttemptIdSchema,
  WriteHashSchema,
  type ExternalOperationAttempt,
} from "./model.ts"
import { createWriteRecoveryUiHandler } from "./recovery-ui.ts"

const organizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
const shopId = ShopIdSchema.parse("30000000-0000-4000-8000-000000000001")
const operationAttemptId = ExternalOperationAttemptIdSchema.parse(`external-attempt:${"d".repeat(64)}`)
const attempt: ExternalOperationAttempt = {
  operationAttemptId,
  organizationId,
  writeAttemptId: WriteAttemptIdSchema.parse(`write-attempt:${"a".repeat(64)}`),
  destinationShopId: shopId,
  step: "media_upload",
  requestFingerprint: WriteHashSchema.parse("e".repeat(64)),
  state: "outcome_unknown",
  retryAllowed: false,
  outcomeReason: "ack_timeout",
}
let resolved = false
const dependencies = {
  authenticate: () => ({ organizationId, actorId: "owner-1", accessibleShopIds: [shopId], canResolve: true }),
  list: async () => [attempt],
  find: async () => attempt,
  resolve: async ({ attempt: current }: { readonly attempt: ExternalOperationAttempt }) => { resolved = true; return { ...current, state: "failed" as const, outcomeReason: "operator_review" } },
}
const response = await createWriteRecoveryUiHandler(
  new Request(`https://app.test/write-recovery/outcome-unknown?organizationId=${organizationId}`, { headers: { authorization: "Bearer fixture" } }),
  dependencies,
)
const body = await response.text()
assert.equal(response.status, 200)
assert.equal(resolved, false)
assert.match(body, /name="decision"/)
assert.match(body, /Shopee write recovery/)
assert.doesNotMatch(body, /access_token|refresh_token|Authorization:/i)

console.log(JSON.stringify({
  scenario: "phase6-write-recovery-operator-ui-contract",
  status: response.status,
  htmlRendered: body.includes("Shopee write recovery"),
  unknownAttemptRendered: body.includes("outcome_unknown"),
  resolutionFormRendered: body.includes('name="decision"'),
  mutationPolicy: "operator_api_only",
  networkCalls: 0,
  databaseCalls: 0,
  shopeeMutations: 0,
  externalWrites: 0,
  secretFieldsPresent: false,
  liveProvider: "not_run",
}, null, 2))
