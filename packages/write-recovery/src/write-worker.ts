import { createHash } from "node:crypto"
import {
  type RuntimePolicyVersion,
  requireRuntimeCapability,
} from "../../runtime-boundaries/src/runtime-boundaries.ts"
import {
  type ExternalOperationAttempt,
  type ExternalOperationStep,
  type OrganizationId,
  type ShopId,
  type WriteAttempt,
  type WritePlan,
  ExternalOperationAttemptIdSchema,
} from "./model.ts"
import type { PostgresWriteRecoveryRepository } from "./postgres-write-recovery.ts"

const STEPS: readonly ExternalOperationStep[] = ["media_upload", "item_create", "variation_init", "publication"]

export type WriteProviderStepInput = {
  readonly organizationId: OrganizationId
  readonly destinationShopId: ShopId
  readonly writeAttemptId: WriteAttempt["attemptId"]
  readonly payloadHash: WriteAttempt["payloadHash"]
  readonly step: ExternalOperationStep
  readonly providerReferences: readonly string[]
}

export type WriteProviderStepResult =
  | { readonly kind: "succeeded"; readonly providerReference: string }
  | { readonly kind: "failed"; readonly reason: string }

export type ConfirmedWriteRevalidationDeniedReason =
  | "authorization_revoked"
  | "authorization_stale"
  | "grant_unavailable"
  | "credential_binding_unavailable"
  | "shop_disconnected"
  | "command_stale"
  | "feature_disabled"
  | "policy_disabled"

export type ConfirmedWriteRevalidationInput = {
  readonly policyVersion: RuntimePolicyVersion
  readonly commandId: WriteAttempt["commandId"]
  readonly organizationId: OrganizationId
  readonly destinationShopId: ShopId
  readonly writeAttemptId: WriteAttempt["attemptId"]
  readonly payloadHash: WriteAttempt["payloadHash"]
  readonly confirmationBinding: WriteAttempt["confirmationBinding"]
  readonly step: ExternalOperationStep
}

export type ConfirmedWriteRevalidationResult =
  | { readonly kind: "allowed" }
  | { readonly kind: "denied"; readonly reason: ConfirmedWriteRevalidationDeniedReason }

export type ConfirmedWriteRevalidator = (
  input: ConfirmedWriteRevalidationInput,
) => Promise<ConfirmedWriteRevalidationResult>

export type ConfirmedWriteProvider = {
  readonly mediaUpload: (input: WriteProviderStepInput) => Promise<WriteProviderStepResult>
  readonly itemCreate: (input: WriteProviderStepInput) => Promise<WriteProviderStepResult>
  readonly variationInit: (input: WriteProviderStepInput) => Promise<WriteProviderStepResult>
  readonly publication: (input: WriteProviderStepInput) => Promise<WriteProviderStepResult>
}

export type ConfirmedWriteWorkerInput = {
  readonly runtimeRole: "worker"
  readonly policyVersion: RuntimePolicyVersion
  readonly plan: WritePlan
  readonly attempt: WriteAttempt
  readonly confirmationBinding: string
}

export type ConfirmedWriteWorkerResult =
  | { readonly kind: "succeeded"; readonly attempt: WriteAttempt; readonly providerReferences: readonly string[] }
  | { readonly kind: "failed"; readonly attempt: WriteAttempt; readonly reason: string }
  | { readonly kind: "outcome_unknown"; readonly attempt: WriteAttempt; readonly step: ExternalOperationStep }
  | { readonly kind: "denied"; readonly attempt: WriteAttempt; readonly step: ExternalOperationStep; readonly reason: ConfirmedWriteRevalidationDeniedReason; readonly providerReferences: readonly string[] }

export class ConfirmedWriteWorkerError extends Error {
  readonly name = "ConfirmedWriteWorkerError"
  readonly code: "capability_gate_blocked" | "confirmation_binding_mismatch" | "attempt_not_dispatchable"

  constructor(code: ConfirmedWriteWorkerError["code"]) {
    super("Confirmed write worker rejected the dispatch boundary")
    this.code = code
  }
}

export async function executeConfirmedWriteWorker(
  input: ConfirmedWriteWorkerInput,
  dependencies: {
    readonly persistence: Pick<PostgresWriteRecoveryRepository, "saveExternalOperationAttempt" | "readExternalOperationAttempt" | "updateExternalOperationAttempt" | "updateAttempt">
    readonly provider: ConfirmedWriteProvider
    readonly revalidate: ConfirmedWriteRevalidator
  },
): Promise<ConfirmedWriteWorkerResult> {
  requireRuntimeCapability({ role: input.runtimeRole, capability: "secret_provider", policyVersion: input.policyVersion })
  requireRuntimeCapability({ role: input.runtimeRole, capability: "shopee_call", policyVersion: input.policyVersion })
  validateDispatchBoundary(input)

  if (input.attempt.state === "succeeded") return { kind: "succeeded", attempt: input.attempt, providerReferences: input.attempt.providerReference === undefined ? [] : [input.attempt.providerReference] }
  if (input.attempt.state === "failed") return { kind: "failed", attempt: input.attempt, reason: input.attempt.outcomeReason ?? "provider_failed" }
  if (input.attempt.state === "outcome_unknown" || input.attempt.state === "reauth_required") return { kind: "outcome_unknown", attempt: input.attempt, step: "publication" }

  const providerReferences: string[] = []
  for (const step of STEPS) {
    const operation = await getOrCreateOperation(input, step, dependencies.persistence)
    if (operation.state === "succeeded") {
      if (operation.providerReference !== undefined) providerReferences.push(operation.providerReference)
      continue
    }
    if (operation.state === "failed") return await finishFailed(input, operation, dependencies.persistence)
    if (operation.state === "outcome_unknown" || operation.state === "reauth_required") return await finishUnknown(input, operation, dependencies.persistence)
    if (operation.state === "sent") {
      const unknown = { ...operation, state: "outcome_unknown" as const, retryAllowed: false }
      await dependencies.persistence.updateExternalOperationAttempt({ attempt: unknown, expectedState: "sent" })
      return await finishUnknown(input, unknown, dependencies.persistence)
    }

    const revalidation = await dependencies.revalidate({
      policyVersion: input.policyVersion,
      commandId: input.attempt.commandId,
      organizationId: input.attempt.organizationId,
      destinationShopId: input.attempt.destinationShopId,
      writeAttemptId: input.attempt.attemptId,
      payloadHash: input.attempt.payloadHash,
      confirmationBinding: input.attempt.confirmationBinding,
      step,
    })
    if (revalidation.kind === "denied") {
      return {
        kind: "denied",
        attempt: input.attempt,
        step,
        reason: revalidation.reason,
        providerReferences: [...providerReferences],
      }
    }

    const sent = { ...operation, state: "sent" as const, retryAllowed: false }
    await dependencies.persistence.updateExternalOperationAttempt({ attempt: sent, expectedState: "prepared" })
    let response: WriteProviderStepResult
    try {
      response = await dependencies.provider[providerMethod(step)]({
        organizationId: input.attempt.organizationId,
        destinationShopId: input.attempt.destinationShopId,
        writeAttemptId: input.attempt.attemptId,
        payloadHash: input.attempt.payloadHash,
        step,
        providerReferences: [...providerReferences],
      })
    } catch {
      const unknown = { ...sent, state: "outcome_unknown" as const, retryAllowed: false }
      await dependencies.persistence.updateExternalOperationAttempt({ attempt: unknown, expectedState: "sent" })
      return await finishUnknown(input, unknown, dependencies.persistence)
    }
    if (response.kind === "failed") {
      const failed = { ...sent, state: "failed" as const, retryAllowed: false, outcomeReason: response.reason }
      await dependencies.persistence.updateExternalOperationAttempt({ attempt: failed, expectedState: "sent" })
      return await finishFailed(input, failed, dependencies.persistence)
    }
    const succeeded = { ...sent, state: "succeeded" as const, retryAllowed: false, providerReference: response.providerReference }
    await dependencies.persistence.updateExternalOperationAttempt({ attempt: succeeded, expectedState: "sent" })
    providerReferences.push(response.providerReference)
  }

  const finalProviderReference = providerReferences.at(-1)
  const succeededAttempt: WriteAttempt = {
    ...input.attempt,
    state: "succeeded",
    dispatchAllowed: false,
    ...(finalProviderReference === undefined ? {} : { providerReference: finalProviderReference }),
  }
  await dependencies.persistence.updateAttempt({ attempt: succeededAttempt, expectedState: input.attempt.state })
  return { kind: "succeeded", attempt: succeededAttempt, providerReferences }
}

function validateDispatchBoundary(input: ConfirmedWriteWorkerInput): void {
  if (input.plan.kind !== "ready" || input.plan.capability.status !== "verified") throw new ConfirmedWriteWorkerError("capability_gate_blocked")
  if (input.attempt.confirmationBinding !== input.confirmationBinding) throw new ConfirmedWriteWorkerError("confirmation_binding_mismatch")
  if (!input.plan.attempts.some((candidate) => candidate.attemptId === input.attempt.attemptId && candidate.commandId === input.attempt.commandId)) throw new ConfirmedWriteWorkerError("attempt_not_dispatchable")
  if (input.attempt.state === "pending" || input.attempt.dispatchAllowed) throw new ConfirmedWriteWorkerError("attempt_not_dispatchable")
}

async function getOrCreateOperation(
  input: ConfirmedWriteWorkerInput,
  step: ExternalOperationStep,
  persistence: Pick<PostgresWriteRecoveryRepository, "saveExternalOperationAttempt" | "readExternalOperationAttempt" | "updateExternalOperationAttempt" | "updateAttempt">,
): Promise<ExternalOperationAttempt> {
  const operationAttemptId = ExternalOperationAttemptIdSchema.parse(`external-attempt:${createHash("sha256").update(`${input.attempt.attemptId}:${step}`).digest("hex")}`)
  const existing = await persistence.readExternalOperationAttempt({ organizationId: input.attempt.organizationId }, operationAttemptId)
  if (existing !== null) return existing
  const prepared: ExternalOperationAttempt = {
    operationAttemptId,
    organizationId: input.attempt.organizationId,
    writeAttemptId: input.attempt.attemptId,
    destinationShopId: input.attempt.destinationShopId,
    step,
    requestFingerprint: input.attempt.payloadHash,
    state: "prepared",
    retryAllowed: true,
  }
  await persistence.saveExternalOperationAttempt(prepared)
  return prepared
}

async function finishUnknown(input: ConfirmedWriteWorkerInput, operation: ExternalOperationAttempt, persistence: Pick<PostgresWriteRecoveryRepository, "saveExternalOperationAttempt" | "readExternalOperationAttempt" | "updateExternalOperationAttempt" | "updateAttempt">): Promise<ConfirmedWriteWorkerResult> {
  const attempt = { ...input.attempt, state: "outcome_unknown" as const, dispatchAllowed: false, outcomeReason: `external_operation_unknown:${operation.step}` }
  await persistence.updateAttempt({ attempt, expectedState: updateExpectedState(input.attempt.state) })
  return { kind: "outcome_unknown", attempt, step: operation.step }
}

async function finishFailed(input: ConfirmedWriteWorkerInput, operation: ExternalOperationAttempt, persistence: Pick<PostgresWriteRecoveryRepository, "saveExternalOperationAttempt" | "readExternalOperationAttempt" | "updateExternalOperationAttempt" | "updateAttempt">): Promise<ConfirmedWriteWorkerResult> {
  const reason = operation.outcomeReason ?? "provider_failed"
  const attempt = { ...input.attempt, state: "failed" as const, dispatchAllowed: false, outcomeReason: reason }
  await persistence.updateAttempt({ attempt, expectedState: updateExpectedState(input.attempt.state) })
  return { kind: "failed", attempt, reason }
}

function providerMethod(step: ExternalOperationStep): "mediaUpload" | "itemCreate" | "variationInit" | "publication" {
  switch (step) {
    case "media_upload": return "mediaUpload"
    case "item_create": return "itemCreate"
    case "variation_init": return "variationInit"
    case "publication": return "publication"
    default: return assertNever(step)
  }
}

function updateExpectedState(state: WriteAttempt["state"]): Extract<WriteAttempt["state"], "pending" | "dispatched" | "outcome_unknown"> {
  if (state === "pending" || state === "dispatched" || state === "outcome_unknown") return state
  throw new Error(`write attempt cannot be updated from terminal state: ${state}`)
}

function assertNever(value: never): never { throw new TypeError(`Unhandled write step: ${String(value)}`) }
