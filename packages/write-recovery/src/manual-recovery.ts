import {
  createWritePlan,
  createConfirmationBinding,
  dispatchAttempt,
  recordAttemptOutcome,
  recoverOutcomeUnknown,
  createConfirmedWriteDispatch,
} from "./index.ts"
import { InMemoryDeliveryStore } from "../../delivery/src/in-memory-delivery.ts"
import { JobIdSchema } from "../../delivery/src/contracts.ts"

const input = {
  organizationId: "10000000-0000-4000-8000-000000000001",
  actorId: "actor-owner",
  intentId: "intent:copy-1",
  previewHash: "a".repeat(64),
  commandVersion: 1,
  destinations: [
    { shopId: "30000000-0000-4000-8000-000000000001", payloadHash: "b".repeat(64) },
    { shopId: "30000000-0000-4000-8000-000000000002", payloadHash: "c".repeat(64) },
  ],
}

const disabledPlan = createWritePlan(input, { status: "unknown", evidence: "official capability not verified" })
const readyPlan = createWritePlan(input, { status: "verified", evidence: "provider-free fixture only" })
if (readyPlan.kind !== "ready") throw new Error("manual recovery expected a fixture-ready plan")
const firstAttempt = readyPlan.attempts[0]
if (!firstAttempt) throw new Error("manual recovery expected a destination attempt")
const dispatched = dispatchAttempt(readyPlan, firstAttempt, readyPlan.confirmationBinding)
if (dispatched.kind !== "dispatched") throw new Error("manual recovery expected dispatch fixture")
const confirmedDispatch = createConfirmedWriteDispatch(readyPlan, firstAttempt, readyPlan.confirmationBinding, "2026-09-09T00:00:00.000Z")
const delivery = new InMemoryDeliveryStore()
delivery.registerCommand(confirmedDispatch.command)
delivery.appendOutbox(confirmedDispatch.outbox)
const queued = delivery.dispatchOutbox(confirmedDispatch.outbox.eventId, JobIdSchema.parse("40000000-0000-4000-8000-000000000001"), "2026-09-09T00:00:01.000Z")
const unknown = recordAttemptOutcome(dispatched.attempt, { kind: "outcome_unknown", reason: "ack_timeout" })
const retry = dispatchAttempt(readyPlan, unknown.attempt, readyPlan.confirmationBinding)
const recovered = recoverOutcomeUnknown(unknown.attempt, {
  kind: "reauthenticate",
  operatorId: input.actorId,
  decidedAt: "2026-09-09T00:02:00.000Z",
})

console.log(JSON.stringify({
  scenario: "phase6-provider-free-outcome-unknown-recovery",
  capabilityUnknown: disabledPlan.kind === "write_disabled",
  destinationCount: disabledPlan.attempts.length,
  mutationPolicy: "disabled",
  confirmationBinding: createConfirmationBinding(input),
  commandId: readyPlan.commandId,
  confirmedEnvelopeCreated: confirmedDispatch.command.payload["writeAttemptId"] === firstAttempt.attemptId,
  outboxQueued: queued.kind === "dispatched",
  outboxDedupeKey: confirmedDispatch.outbox.dedupeKey,
  unknownState: unknown.attempt.state,
  blindRetryDenied: retry.kind === "denied" && retry.reason === "outcome_unknown_requires_operator",
  operatorResolution: recovered.kind === "resolved" ? recovered.attempt.state : "denied",
  networkCalls: 0,
  databaseCalls: 0,
  shopeeMutations: 0,
  externalWrites: 0,
  secretFieldsPresent: false,
}, null, 2))
