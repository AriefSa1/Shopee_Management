import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { createWriteRecoveryApiHandler, type WriteRecoveryApiDependencies } from "./index.ts"
import {
  ExternalOperationAttemptIdSchema,
  OrganizationIdSchema,
  ShopIdSchema,
  WriteAttemptIdSchema,
  WriteHashSchema,
  type ExternalOperationAttempt,
} from "./model.ts"

const organizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
const shopId = ShopIdSchema.parse("30000000-0000-4000-8000-000000000001")
const otherShopId = ShopIdSchema.parse("30000000-0000-4000-8000-000000000002")
const operation: ExternalOperationAttempt = {
  operationAttemptId: ExternalOperationAttemptIdSchema.parse(`external-attempt:${"d".repeat(64)}`),
  organizationId,
  writeAttemptId: WriteAttemptIdSchema.parse(`write-attempt:${"a".repeat(64)}`),
  destinationShopId: shopId,
  step: "media_upload",
  requestFingerprint: WriteHashSchema.parse("e".repeat(64)),
  state: "outcome_unknown",
  retryAllowed: false,
  outcomeReason: "ack_timeout",
}

function dependencies(overrides: Partial<WriteRecoveryApiDependencies> = {}): WriteRecoveryApiDependencies {
  return {
    authenticate: () => ({ organizationId, actorId: "actor-owner", accessibleShopIds: [shopId], canResolve: true }),
    list: async () => [operation],
    find: async () => operation,
    resolve: async ({ attempt }) => ({ ...attempt, state: "reauth_required", outcomeReason: "reauth_required:actor-owner" }),
    ...overrides,
  }
}

describe("write-recovery operator API boundary", () => {
  it("requires bearer authentication before reading recovery state", async () => {
    const response = await createWriteRecoveryApiHandler(new Request(`https://example.test/api/write-recovery/outcome-unknown?organizationId=${organizationId}`), dependencies())
    assert.equal(response.status, 401)
  })

  it("lists only outcome_unknown attempts within organization and shop scope", async () => {
    const response = await createWriteRecoveryApiHandler(new Request(`https://example.test/api/write-recovery/outcome-unknown?organizationId=${organizationId}&shopId=${shopId}`, { headers: { authorization: "Bearer fixture" } }), dependencies({ list: async () => [operation, { ...operation, operationAttemptId: ExternalOperationAttemptIdSchema.parse(`external-attempt:${"f".repeat(64)}`), state: "failed", destinationShopId: otherShopId }] }))
    assert.equal(response.status, 200)
    const body = await response.json() as { data: { attempts: readonly ExternalOperationAttempt[]; canResolve: boolean } }
    assert.equal(body.data.attempts.length, 1)
    assert.equal(body.data.attempts[0]?.operationAttemptId, operation.operationAttemptId)
    assert.equal(body.data.canResolve, true)
  })

  it("denies organization and inaccessible-shop queries", async () => {
    const foreign = await createWriteRecoveryApiHandler(new Request(`https://example.test/api/write-recovery/outcome-unknown?organizationId=10000000-0000-4000-8000-000000000009`, { headers: { authorization: "Bearer fixture" } }), dependencies())
    assert.equal(foreign.status, 403)
    const inaccessible = await createWriteRecoveryApiHandler(new Request(`https://example.test/api/write-recovery/outcome-unknown?organizationId=${organizationId}&shopId=${otherShopId}`, { headers: { authorization: "Bearer fixture" } }), dependencies())
    assert.equal(inaccessible.status, 403)
  })

  it("requires recovery permission before accepting an operator decision", async () => {
    const response = await createWriteRecoveryApiHandler(new Request("https://example.test/api/write-recovery/outcome-unknown", { method: "POST", headers: { authorization: "Bearer fixture", "content-type": "application/json" }, body: JSON.stringify({ organizationId, operationAttemptId: operation.operationAttemptId, decision: { kind: "reauthenticate" } }) }), dependencies({ authenticate: () => ({ organizationId, actorId: "actor-staff", accessibleShopIds: [shopId], canResolve: false }) }))
    assert.equal(response.status, 403)
  })

  it("binds the recovery decision to the authenticated actor and never trusts a client operator", async () => {
    let receivedOperatorId = ""
    const response = await createWriteRecoveryApiHandler(new Request("https://example.test/api/write-recovery/outcome-unknown", { method: "POST", headers: { authorization: "Bearer fixture", "content-type": "application/json" }, body: JSON.stringify({ organizationId, operationAttemptId: operation.operationAttemptId, decision: { kind: "mark_failed", reason: "operator_review" } }) }), dependencies({ resolve: async ({ decision }) => {
      receivedOperatorId = decision.operatorId
      if (decision.kind !== "mark_failed") {
        throw new Error("fixture decision kind mismatch")
      }
      return { ...operation, state: "failed", retryAllowed: false, outcomeReason: decision.reason }
    } }))
    assert.equal(response.status, 202)
    assert.equal(receivedOperatorId, "actor-owner")
    const body = await response.json() as { data: { attempt: ExternalOperationAttempt; operatorId: string } }
    assert.equal(body.data.operatorId, "actor-owner")
    assert.equal(body.data.attempt.state, "failed")
  })

  it("rejects malformed decisions and non-unknown attempts", async () => {
    const malformed = await createWriteRecoveryApiHandler(new Request("https://example.test/api/write-recovery/outcome-unknown", { method: "POST", headers: { authorization: "Bearer fixture", "content-type": "application/json" }, body: JSON.stringify({ organizationId, operationAttemptId: operation.operationAttemptId, decision: { kind: "confirm_succeeded" } }) }), dependencies())
    assert.equal(malformed.status, 400)
    const nonUnknown = await createWriteRecoveryApiHandler(new Request("https://example.test/api/write-recovery/outcome-unknown", { method: "POST", headers: { authorization: "Bearer fixture", "content-type": "application/json" }, body: JSON.stringify({ organizationId, operationAttemptId: operation.operationAttemptId, decision: { kind: "reauthenticate" } }) }), dependencies({ find: async () => ({ ...operation, state: "sent", retryAllowed: false }) }))
    assert.equal(nonUnknown.status, 409)
  })

  it("fails closed when a resolver returns a mismatched or retryable state", async () => {
    const response = await createWriteRecoveryApiHandler(new Request("https://example.test/api/write-recovery/outcome-unknown", { method: "POST", headers: { authorization: "Bearer fixture", "content-type": "application/json" }, body: JSON.stringify({ organizationId, operationAttemptId: operation.operationAttemptId, decision: { kind: "reauthenticate" } }) }), dependencies({ resolve: async ({ attempt: current }) => ({ ...current, destinationShopId: otherShopId, state: "reauth_required", retryAllowed: false }) }))
    assert.equal(response.status, 502)
  })
})
