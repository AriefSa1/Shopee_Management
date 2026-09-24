import { z } from "zod"

export const CapabilityStatusSchema = z.enum(["verified", "unknown", "denied"])
export const WriteAttemptStateSchema = z.enum([
  "pending",
  "dispatched",
  "succeeded",
  "failed",
  "outcome_unknown",
  "reauth_required",
])
export const WriteOutcomeSchema = z.enum(["succeeded", "failed", "outcome_unknown"])
export const OrganizationIdSchema = z.string().uuid().brand("WriteRecoveryOrganizationId")
export const ShopIdSchema = z.string().uuid().brand("WriteRecoveryShopId")
export const WriteHashSchema = z.string().regex(/^[a-f0-9]{64}$/).brand("WriteRecoveryHash")
export const WriteCommandIdSchema = z.string().regex(/^write-command:[a-f0-9]{64}$/).brand("WriteCommandId")
export const WriteAttemptIdSchema = z.string().regex(/^write-attempt:[a-f0-9]{64}$/).brand("WriteAttemptId")
export const ExternalOperationAttemptIdSchema = z.string().regex(/^external-attempt:[a-f0-9]{64}$/).brand("ExternalOperationAttemptId")
export const ExternalOperationStepSchema = z.enum(["media_upload", "item_create", "variation_init", "publication"])
export const ExternalOperationStateSchema = z.enum(["prepared", "sent", "succeeded", "failed", "outcome_unknown", "reauth_required"])
export const WriteTimestampSchema = z.string().datetime({ offset: true })

export const CapabilityGateSchema = z.object({
  status: CapabilityStatusSchema,
  evidence: z.string().trim().min(1).max(255),
}).strict().readonly()

export const WriteDestinationSchema = z.object({
  shopId: ShopIdSchema,
  payloadHash: WriteHashSchema,
}).strict().readonly()

export const WritePlanInputSchema = z.object({
  organizationId: OrganizationIdSchema,
  actorId: z.string().trim().min(1).max(128),
  intentId: z.string().trim().min(1).max(255),
  previewHash: WriteHashSchema,
  commandVersion: z.number().int().positive(),
  destinations: z.array(WriteDestinationSchema).min(1).max(100),
}).strict().readonly()

export type CapabilityStatus = z.infer<typeof CapabilityStatusSchema>
export type CapabilityGate = z.infer<typeof CapabilityGateSchema>
export type WriteAttemptState = z.infer<typeof WriteAttemptStateSchema>
export type WriteOutcome = z.infer<typeof WriteOutcomeSchema>
export type OrganizationId = z.infer<typeof OrganizationIdSchema>
export type ShopId = z.infer<typeof ShopIdSchema>
export type WriteHash = z.infer<typeof WriteHashSchema>
export type WriteCommandId = z.infer<typeof WriteCommandIdSchema>
export type WriteAttemptId = z.infer<typeof WriteAttemptIdSchema>
export type ExternalOperationAttemptId = z.infer<typeof ExternalOperationAttemptIdSchema>
export type ExternalOperationStep = z.infer<typeof ExternalOperationStepSchema>
export type ExternalOperationState = z.infer<typeof ExternalOperationStateSchema>
export type WriteDestination = z.infer<typeof WriteDestinationSchema>
export type WritePlanInput = z.infer<typeof WritePlanInputSchema>

export type WriteConfirmation = {
  readonly bindingHash: WriteHash
  readonly organizationId: OrganizationId
  readonly actorId: string
  readonly intentId: string
  readonly commandVersion: number
  readonly destinationShopIds: readonly ShopId[]
}

export type WriteAttempt = {
  readonly attemptId: WriteAttemptId
  readonly commandId: WriteCommandId
  readonly organizationId: OrganizationId
  readonly destinationShopId: ShopId
  readonly payloadHash: WriteHash
  readonly state: WriteAttemptState
  readonly dispatchAllowed: boolean
  readonly confirmationBinding: WriteHash
  readonly outcomeReason?: string
  readonly providerReference?: string
}

export type ExternalOperationAttempt = {
  readonly operationAttemptId: ExternalOperationAttemptId
  readonly organizationId: OrganizationId
  readonly writeAttemptId: WriteAttemptId
  readonly destinationShopId: ShopId
  readonly step: ExternalOperationStep
  readonly requestFingerprint: WriteHash
  readonly state: ExternalOperationState
  readonly retryAllowed: boolean
  readonly outcomeReason?: string
  readonly providerReference?: string
}

export type WritePlan =
  | {
      readonly kind: "write_disabled"
      readonly commandId: WriteCommandId
      readonly capability: CapabilityGate
      readonly confirmationBinding: WriteHash
      readonly attempts: readonly WriteAttempt[]
    }
  | {
      readonly kind: "ready"
      readonly commandId: WriteCommandId
      readonly capability: CapabilityGate
      readonly confirmationBinding: WriteHash
      readonly attempts: readonly WriteAttempt[]
    }

export type DispatchDeniedReason =
  | "capability_gate_blocked"
  | "confirmation_binding_mismatch"
  | "outcome_unknown_requires_operator"
  | "attempt_not_owned"
  | "attempt_not_pending"

export type DispatchResult =
  | { readonly kind: "dispatched"; readonly attempt: WriteAttempt }
  | { readonly kind: "denied"; readonly reason: DispatchDeniedReason; readonly attempt: WriteAttempt }

export type RecoveryDecision =
  | { readonly kind: "reauthenticate"; readonly operatorId: string; readonly decidedAt: string }
  | { readonly kind: "mark_failed"; readonly operatorId: string; readonly decidedAt: string; readonly reason: string }
  | { readonly kind: "confirm_succeeded"; readonly operatorId: string; readonly decidedAt: string; readonly providerReference: string }

export type RecoveryResult =
  | { readonly kind: "resolved"; readonly attempt: WriteAttempt }
  | { readonly kind: "denied"; readonly reason: "attempt_not_outcome_unknown"; readonly attempt: WriteAttempt }
