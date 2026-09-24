import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  createConfirmationBinding,
  createWritePlan,
  dispatchAttempt,
  recordAttemptOutcome,
  recoverOutcomeUnknown,
  type WritePlanInput,
} from "./index.ts"
import { OrganizationIdSchema, ShopIdSchema, WriteHashSchema } from "./model.ts"

const baseInput: WritePlanInput = {
  organizationId: OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001"),
  actorId: "actor-owner",
  intentId: "intent:copy-1",
  previewHash: WriteHashSchema.parse("a".repeat(64)),
  commandVersion: 1,
  destinations: [
    { shopId: ShopIdSchema.parse("30000000-0000-4000-8000-000000000001"), payloadHash: WriteHashSchema.parse("b".repeat(64)) },
    { shopId: ShopIdSchema.parse("30000000-0000-4000-8000-000000000002"), payloadHash: WriteHashSchema.parse("c".repeat(64)) },
  ],
}

describe("provider-free Phase 6 write recovery contract", () => {
  it("fails closed when capability is unknown and keeps every destination disabled", () => {
    const plan = createWritePlan(baseInput, { status: "unknown", evidence: "not verified" })

    assert.equal(plan.kind, "write_disabled")
    assert.deepEqual(plan.attempts.map((attempt) => attempt.state), ["pending", "pending"])
    assert.equal(plan.attempts.every((attempt) => attempt.dispatchAllowed === false), true)
  })

  it("binds confirmation to the exact organization, intent, version, and destination payloads", () => {
    const binding = createConfirmationBinding(baseInput)
    const changed = createConfirmationBinding({ ...baseInput, commandVersion: 2 })

    assert.equal(binding.length, 64)
    assert.notEqual(binding, changed)
  })

  it("uses one idempotent command identity for repeated planning", () => {
    const first = createWritePlan(baseInput, { status: "verified", evidence: "staging fixture" })
    const second = createWritePlan(baseInput, { status: "verified", evidence: "staging fixture" })

    assert.equal(first.kind, "ready")
    assert.equal(second.kind, "ready")
    assert.equal(first.commandId, second.commandId)
    assert.deepEqual(
      first.attempts.map((attempt) => attempt.attemptId),
      second.attempts.map((attempt) => attempt.attemptId),
    )
  })

  it("requires an explicit confirmation binding before dispatch", () => {
    const plan = createWritePlan(baseInput, { status: "verified", evidence: "staging fixture" })
    assert.equal(plan.kind, "ready")

    const pending = plan.attempts[0]
    assert.ok(pending)
    const result = dispatchAttempt(plan, pending, "wrong-binding")

    assert.equal(result.kind, "denied")
    if (result.kind === "denied") {
      assert.equal(result.reason, "confirmation_binding_mismatch")
      assert.equal(result.attempt.state, "pending")
    }
  })

  it("denies dispatch for a denied capability even with a matching binding", () => {
    const plan = createWritePlan(baseInput, { status: "denied", evidence: "permission not granted" })
    const attempt = plan.attempts[0]
    assert.ok(attempt)
    const result = dispatchAttempt(plan, attempt, plan.confirmationBinding)
    assert.equal(result.kind, "denied")
    assert.equal(result.reason, "capability_gate_blocked")
    assert.equal(result.attempt.state, "pending")
  })

  it("moves a dispatched attempt to outcome_unknown and forbids blind retry", () => {
    const plan = createWritePlan(baseInput, { status: "verified", evidence: "staging fixture" })
    assert.equal(plan.kind, "ready")
    const pending = plan.attempts[0]
    assert.ok(pending)
    const dispatched = dispatchAttempt(plan, pending, plan.confirmationBinding)
    assert.equal(dispatched.kind, "dispatched")

    const unknown = recordAttemptOutcome(dispatched.attempt, { kind: "outcome_unknown", reason: "ack_timeout" })

    assert.equal(unknown.attempt.state, "outcome_unknown")
    const retry = dispatchAttempt(plan, unknown.attempt, plan.confirmationBinding)
    assert.equal(retry.kind, "denied")
    if (retry.kind === "denied") assert.equal(retry.reason, "outcome_unknown_requires_operator")
  })

  it("allows only explicit operator decisions for outcome_unknown", () => {
    const plan = createWritePlan(baseInput, { status: "verified", evidence: "staging fixture" })
    assert.equal(plan.kind, "ready")
    const pending = plan.attempts[0]
    assert.ok(pending)
    const dispatched = dispatchAttempt(plan, pending, plan.confirmationBinding)
    assert.equal(dispatched.kind, "dispatched")
    const unknown = recordAttemptOutcome(dispatched.attempt, { kind: "outcome_unknown", reason: "provider_timeout" })

    const recovered = recoverOutcomeUnknown(unknown.attempt, {
      kind: "reauthenticate",
      operatorId: "actor-owner",
      decidedAt: "2026-09-09T00:02:00.000Z",
    })

    assert.equal(recovered.kind, "resolved")
    assert.equal(recovered.attempt.state, "reauth_required")
    assert.equal(recovered.attempt.dispatchAllowed, false)
  })

  it("records succeeded and failed as terminal non-dispatchable states", () => {
    const plan = createWritePlan(baseInput, { status: "verified", evidence: "staging fixture" })
    assert.equal(plan.kind, "ready")
    const first = plan.attempts[0]
    const second = plan.attempts[1]
    assert.ok(first)
    assert.ok(second)
    const dispatchedFirst = dispatchAttempt(plan, first, plan.confirmationBinding)
    const dispatchedSecond = dispatchAttempt(plan, second, plan.confirmationBinding)
    assert.equal(dispatchedFirst.kind, "dispatched")
    assert.equal(dispatchedSecond.kind, "dispatched")
    const succeeded = recordAttemptOutcome(dispatchedFirst.attempt, { kind: "succeeded", providerReference: "fixture-1" })
    const failed = recordAttemptOutcome(dispatchedSecond.attempt, { kind: "failed", reason: "validation_failed" })
    assert.equal(succeeded.attempt.state, "succeeded")
    assert.equal(failed.attempt.state, "failed")
    assert.equal(succeeded.attempt.dispatchAllowed, false)
    assert.equal(failed.attempt.dispatchAllowed, false)
  })
})
