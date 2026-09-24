import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  ExternalOperationAttemptIdSchema,
  OrganizationIdSchema,
  ShopIdSchema,
  WriteAttemptIdSchema,
  WriteHashSchema,
  type ExternalOperationAttempt,
} from "./model.ts"
import { createWriteRecoveryUiHandler } from "./recovery-ui.ts"
import type { WriteRecoveryApiDependencies } from "./recovery-api.ts"

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
  outcomeReason: "<unsafe-reason>",
}

function dependencies(overrides: Partial<WriteRecoveryApiDependencies> = {}): WriteRecoveryApiDependencies {
  return {
    authenticate: () => ({ organizationId, actorId: "owner-1", accessibleShopIds: [shopId], canResolve: true }),
    list: async () => [attempt],
    find: async () => attempt,
    resolve: async ({ attempt: current }) => ({ ...current, state: "failed", outcomeReason: "operator_review" }),
    ...overrides,
  }
}

describe("write recovery operator UI boundary", () => {
  it("renders scoped unknown attempts and escapes untrusted text", async () => {
    const response = await createWriteRecoveryUiHandler(
      new Request(`https://app.test/write-recovery/outcome-unknown?organizationId=${organizationId}`, { headers: { authorization: "Bearer fixture" } }),
      dependencies(),
    )
    const body = await response.text()
    assert.equal(response.status, 200)
    assert.match(body, /Shopee write recovery/)
    assert.match(body, /external-attempt:/)
    assert.match(body, /&lt;unsafe-reason&gt;/)
    assert.doesNotMatch(body, /<unsafe-reason>/)
    assert.match(body, /name="decision"/)
  })

  it("submits an HTML form through the same recovery API authorization boundary", async () => {
    let resolved = false
    const response = await createWriteRecoveryUiHandler(
      new Request("https://app.test/write-recovery/outcome-unknown", {
        method: "POST",
        headers: { authorization: "Bearer fixture", "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ organizationId, operationAttemptId, decision: "mark_failed", reason: "operator_review" }),
      }),
      dependencies({ resolve: async ({ attempt: current }) => { resolved = true; return { ...current, state: "failed", outcomeReason: "operator_review" } } }),
    )
    assert.equal(response.status, 202)
    assert.equal(resolved, true)
    assert.match(await response.text(), /Recovery decision recorded/)
  })

  it("keeps the UI fail-closed when permission is absent", async () => {
    const response = await createWriteRecoveryUiHandler(
      new Request(`https://app.test/write-recovery/outcome-unknown?organizationId=${organizationId}`, { headers: { authorization: "Bearer fixture" } }),
      dependencies({ authenticate: () => ({ organizationId, actorId: "staff-1", accessibleShopIds: [shopId], canResolve: false }) }),
    )
    assert.equal(response.status, 200)
    const body = await response.text()
    assert.match(body, /Operator resolution unavailable/)
    assert.doesNotMatch(body, /name="decision"/)
  })

  it("returns an escaped authentication error page", async () => {
    const response = await createWriteRecoveryUiHandler(
      new Request("https://app.test/write-recovery/outcome-unknown"),
      dependencies({ authenticate: () => null }),
    )
    assert.equal(response.status, 401)
    assert.match(await response.text(), /authentication_required/)
  })
})
