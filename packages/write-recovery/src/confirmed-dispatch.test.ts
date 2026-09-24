import assert from "node:assert/strict"
import test from "node:test"
import { JobIdSchema } from "../../delivery/src/contracts.ts"
import { InMemoryDeliveryStore } from "../../delivery/src/in-memory-delivery.ts"
import { createConfirmedWriteDispatch, ConfirmedDispatchContractError, createWritePlan, type WritePlanInput } from "./index.ts"

const input: WritePlanInput = {
  organizationId: "10000000-0000-4000-8000-000000000001" as WritePlanInput["organizationId"],
  actorId: "actor-owner",
  intentId: "intent:copy-1",
  previewHash: "a".repeat(64) as WritePlanInput["previewHash"],
  commandVersion: 1,
  destinations: [{ shopId: "30000000-0000-4000-8000-000000000001" as WritePlanInput["destinations"][number]["shopId"], payloadHash: "b".repeat(64) as WritePlanInput["destinations"][number]["payloadHash"] }],
}

test("creates a confirmed command and outbox event with deterministic per-attempt identity", () => {
  const plan = createWritePlan(input, { status: "verified", evidence: "provider-free fixture" })
  const firstAttempt = plan.attempts[0]
  assert.ok(firstAttempt)
  const first = createConfirmedWriteDispatch(plan, firstAttempt, plan.confirmationBinding, "2026-09-09T00:00:00.000Z")
  const second = createConfirmedWriteDispatch(plan, firstAttempt, plan.confirmationBinding, "2026-09-09T00:00:00.000Z")
  assert.equal(first.command.commandId, second.command.commandId)
  assert.equal(first.outbox.eventId, second.outbox.eventId)
  assert.equal(first.command.payload["writeCommandId"], plan.commandId)
  assert.equal(first.command.payload["writeAttemptId"], firstAttempt.attemptId)
  assert.equal(first.outbox.commandId, first.command.commandId)
})

test("composes with the delivery outbox and remains idempotent", () => {
  const plan = createWritePlan(input, { status: "verified", evidence: "provider-free fixture" })
  const firstAttempt = plan.attempts[0]
  assert.ok(firstAttempt)
  const dispatch = createConfirmedWriteDispatch(plan, firstAttempt, plan.confirmationBinding, "2026-09-09T00:00:00.000Z")
  const store = new InMemoryDeliveryStore()
  store.registerCommand(dispatch.command)
  store.appendOutbox(dispatch.outbox)
  const first = store.dispatchOutbox(dispatch.outbox.eventId, JobIdSchema.parse("40000000-0000-4000-8000-000000000001"), "2026-09-09T00:00:01.000Z")
  const duplicate = store.dispatchOutbox(dispatch.outbox.eventId, JobIdSchema.parse("40000000-0000-4000-8000-000000000002"), "2026-09-09T00:00:02.000Z")
  assert.equal(first.kind, "dispatched")
  assert.equal(duplicate.kind, "duplicate")
})

test("does not create an envelope when capability or confirmation is blocked", () => {
  const disabled = createWritePlan(input, { status: "unknown", evidence: "official capability not verified" })
  const disabledAttempt = disabled.attempts[0]
  assert.ok(disabledAttempt)
  assert.throws(
    () => createConfirmedWriteDispatch(disabled, disabledAttempt, disabled.confirmationBinding, "2026-09-09T00:00:00.000Z"),
    (error: unknown) => error instanceof ConfirmedDispatchContractError && error.code === "capability_gate_blocked",
  )

  const ready = createWritePlan(input, { status: "verified", evidence: "provider-free fixture" })
  const readyAttempt = ready.attempts[0]
  assert.ok(readyAttempt)
  assert.throws(
    () => createConfirmedWriteDispatch(ready, readyAttempt, "c".repeat(64), "2026-09-09T00:00:00.000Z"),
    (error: unknown) => error instanceof ConfirmedDispatchContractError && error.code === "confirmation_binding_mismatch",
  )
})
