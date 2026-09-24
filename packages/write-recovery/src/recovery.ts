import { createHash } from "node:crypto"
import {
  CapabilityGateSchema,
  type DispatchResult,
  type RecoveryDecision,
  type RecoveryResult,
  type WriteAttempt,
  type WriteConfirmation,
  type WriteHash,
  type WriteOutcome,
  type WritePlan,
  type WritePlanInput,
  WriteAttemptIdSchema,
  WriteCommandIdSchema,
  WritePlanInputSchema,
  WriteTimestampSchema,
  WriteHashSchema,
} from "./model.ts"

function stableValue(value: unknown): string {
  return JSON.stringify(value)
}

function hashValue(value: unknown): WriteHash {
  return WriteHashSchema.parse(createHash("sha256").update(stableValue(value)).digest("hex"))
}

function normalizedInput(rawInput: unknown): WritePlanInput {
  const input = WritePlanInputSchema.parse(rawInput)
  return {
    ...input,
    destinations: [...input.destinations].sort((left, right) => left.shopId.localeCompare(right.shopId)),
  }
}

export function createConfirmationBinding(rawInput: unknown): WriteHash {
  const input = normalizedInput(rawInput)
  return hashValue({
    organizationId: input.organizationId,
    actorId: input.actorId,
    intentId: input.intentId,
    previewHash: input.previewHash,
    commandVersion: input.commandVersion,
    destinations: input.destinations,
  })
}

function createConfirmation(input: WritePlanInput): WriteConfirmation {
  return {
    bindingHash: createConfirmationBinding(input),
    organizationId: input.organizationId,
    actorId: input.actorId,
    intentId: input.intentId,
    commandVersion: input.commandVersion,
    destinationShopIds: input.destinations.map((destination) => destination.shopId),
  }
}

function createAttempt(input: WritePlanInput, confirmation: WriteConfirmation, destination: WritePlanInput["destinations"][number]): WriteAttempt {
  const attemptHash = hashValue({
    command: {
      organizationId: input.organizationId,
      actorId: input.actorId,
      intentId: input.intentId,
      previewHash: input.previewHash,
      commandVersion: input.commandVersion,
    },
    destination,
  })
  return {
    attemptId: WriteAttemptIdSchema.parse(`write-attempt:${attemptHash}`),
    commandId: WriteCommandIdSchema.parse(`write-command:${hashValue({
      organizationId: input.organizationId,
      actorId: input.actorId,
      intentId: input.intentId,
      previewHash: input.previewHash,
      commandVersion: input.commandVersion,
      destinations: input.destinations,
    })}`),
    organizationId: input.organizationId,
    destinationShopId: destination.shopId,
    payloadHash: destination.payloadHash,
    state: "pending",
    dispatchAllowed: true,
    confirmationBinding: confirmation.bindingHash,
  }
}

export function createWritePlan(rawInput: unknown, rawCapability: unknown): WritePlan {
  const input = normalizedInput(rawInput)
  const capability = CapabilityGateSchema.parse(rawCapability)
  const confirmation = createConfirmation(input)
  const attempts = input.destinations.map((destination) => createAttempt(input, confirmation, destination))
  if (capability.status !== "verified") {
    return {
      kind: "write_disabled",
      commandId: attempts[0]?.commandId ?? WriteCommandIdSchema.parse(`write-command:${confirmation.bindingHash}`),
      capability,
      confirmationBinding: confirmation.bindingHash,
      attempts: attempts.map((attempt) => ({ ...attempt, dispatchAllowed: false })),
    }
  }
  return {
    kind: "ready",
    commandId: attempts[0]?.commandId ?? WriteCommandIdSchema.parse(`write-command:${confirmation.bindingHash}`),
    capability,
    confirmationBinding: confirmation.bindingHash,
    attempts,
  }
}

export function dispatchAttempt(plan: WritePlan, attempt: WriteAttempt, confirmationBinding: string): DispatchResult {
  const owned = plan.attempts.some((candidate) => candidate.attemptId === attempt.attemptId && candidate.commandId === attempt.commandId)
  if (!owned) return { kind: "denied", reason: "attempt_not_owned", attempt }
  if (plan.kind !== "ready" || plan.capability.status !== "verified") return { kind: "denied", reason: "capability_gate_blocked", attempt }
  if (attempt.confirmationBinding !== confirmationBinding) return { kind: "denied", reason: "confirmation_binding_mismatch", attempt }
  if (attempt.state === "outcome_unknown") return { kind: "denied", reason: "outcome_unknown_requires_operator", attempt }
  if (attempt.state !== "pending") return { kind: "denied", reason: "attempt_not_pending", attempt }
  return { kind: "dispatched", attempt: { ...attempt, state: "dispatched", dispatchAllowed: false } }
}

export function recordAttemptOutcome(attempt: WriteAttempt, outcome: { readonly kind: WriteOutcome; readonly reason?: string; readonly providerReference?: string }): { readonly attempt: WriteAttempt } {
  if (attempt.state !== "dispatched") throw new WriteRecoveryContractError("outcome_requires_dispatched_attempt")
  if (outcome.kind === "succeeded") {
    const providerReference = outcome.providerReference ?? "provider-reference-unavailable"
    return { attempt: { ...attempt, state: "succeeded", dispatchAllowed: false, providerReference } }
  }
  if (outcome.kind === "failed") {
    const reason = outcome.reason ?? "provider_failed"
    return { attempt: { ...attempt, state: "failed", dispatchAllowed: false, outcomeReason: reason } }
  }
  return { attempt: { ...attempt, state: "outcome_unknown", dispatchAllowed: false, outcomeReason: outcome.reason ?? "provider_acknowledgement_unknown" } }
}

export function recoverOutcomeUnknown(attempt: WriteAttempt, decision: RecoveryDecision): RecoveryResult {
  if (attempt.state !== "outcome_unknown") return { kind: "denied", reason: "attempt_not_outcome_unknown", attempt }
  WriteTimestampSchema.parse(decision.decidedAt)
  if (decision.kind === "reauthenticate") return { kind: "resolved", attempt: { ...attempt, state: "reauth_required", dispatchAllowed: false, outcomeReason: `reauth_required:${decision.operatorId}` } }
  if (decision.kind === "mark_failed") return { kind: "resolved", attempt: { ...attempt, state: "failed", dispatchAllowed: false, outcomeReason: decision.reason } }
  return { kind: "resolved", attempt: { ...attempt, state: "succeeded", dispatchAllowed: false, providerReference: decision.providerReference } }
}

export class WriteRecoveryContractError extends Error {
  readonly name = "WriteRecoveryContractError"
  readonly code: "outcome_requires_dispatched_attempt"

  constructor(code: "outcome_requires_dispatched_attempt") {
    super("Write recovery contract rejected an invalid state transition")
    this.code = code
  }
}
