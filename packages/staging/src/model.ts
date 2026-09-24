import { z } from "zod"
import {
  OrganizationIdSchema,
  ShopIdSchema,
  type OrganizationId,
} from "../../identity/src/model.ts"

export { OrganizationIdSchema, ShopIdSchema }

export const StagingCapabilityGateStateSchema = z.enum(["verified", "unknown", "denied"])
export type StagingCapabilityGateState = z.infer<typeof StagingCapabilityGateStateSchema>

export const StagingCapabilityGatesSchema = z
  .object({
    officialProductWrite: StagingCapabilityGateStateSchema,
    mediaLifecycle: StagingCapabilityGateStateSchema,
    itemCorrelation: StagingCapabilityGateStateSchema,
    variationAtomicity: StagingCapabilityGateStateSchema,
    safeRecovery: StagingCapabilityGateStateSchema,
  })
  .strict()
  .readonly()

export const StagingFeatureFlagsSchema = z
  .object({
    environment: z.literal("staging"),
    writePilotEnabled: z.boolean(),
    capabilityGates: StagingCapabilityGatesSchema,
  })
  .strict()
  .readonly()

export type StagingFeatureFlags = z.infer<typeof StagingFeatureFlagsSchema>

export const StagingReconciliationStatusSchema = z.enum(["clean", "mismatch", "unavailable"])
export type StagingReconciliationStatus = z.infer<typeof StagingReconciliationStatusSchema>

export const StagingReconciliationSnapshotSchema = z
  .object({
    organizationId: OrganizationIdSchema,
    shopId: ShopIdSchema,
    collectedAt: z.string().datetime({ offset: true }),
    status: StagingReconciliationStatusSchema,
    expectedDestinationCount: z.number().int().nonnegative(),
    observedDestinationCount: z.number().int().nonnegative(),
  })
  .strict()
  .readonly()
  .superRefine((snapshot, context) => {
    if (snapshot.status === "clean" && snapshot.expectedDestinationCount !== snapshot.observedDestinationCount) {
      context.addIssue({ code: "custom", message: "clean reconciliation requires equal destination counts" })
    }
  })

export type StagingReconciliationSnapshot = z.infer<typeof StagingReconciliationSnapshotSchema>

export type StagingWriteGate =
  | { readonly kind: "write_disabled"; readonly reason: "capability_unknown" | "capability_denied" | "feature_flag_disabled" }
  | { readonly kind: "write_eligible" }

export type StagingHoldControl =
  | { readonly kind: "hold_active"; readonly reason: "write_gate_disabled" | "reconciliation_mismatch" | "reconciliation_unavailable" }
  | { readonly kind: "hold_released" }

export type StagingRollbackControl = {
  readonly kind: "rollback_ready"
  readonly action: "disable_write_dispatch"
}

export type ReadOnlyAlphaWorkflow = {
  readonly organizationId: OrganizationId
  readonly environment: "staging"
  readonly writeGate: StagingWriteGate
  readonly mutationPolicy: "blocked"
  readonly allowedOperations: readonly ["catalog_read", "analytics_read", "copy_preview", "reconciliation_review"]
  readonly blockedOperations: readonly ["media_upload", "product_create", "variation_create"]
  readonly holdControl: StagingHoldControl
  readonly rollbackControl: StagingRollbackControl
}

export const PilotMeasurementCaptureSchema = z
  .object({
    organizationId: OrganizationIdSchema,
    capturedAt: z.string().datetime({ offset: true }),
    workflow: z.literal("multi_store_product_management"),
    baselineMinutes: z.number().finite().positive(),
    observedMinutes: z.number().finite().nonnegative(),
    sampleCount: z.number().int().positive(),
    targetReductionPercent: z.number().finite().min(50, "Pilot target must be at least 50%").max(100),
  })
  .strict()
  .readonly()

export type PilotMeasurementCapture = z.infer<typeof PilotMeasurementCaptureSchema>

export type PilotMeasurementOutcome =
  | { readonly kind: "target_met"; readonly reductionPercent: number; readonly targetReductionPercent: number }
  | { readonly kind: "target_missed"; readonly reductionPercent: number; readonly targetReductionPercent: number }
