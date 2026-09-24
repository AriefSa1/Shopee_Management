import type {
  ReadOnlyAlphaWorkflow,
  StagingFeatureFlags,
  StagingHoldControl,
  StagingReconciliationSnapshot,
  StagingWriteGate,
} from "./model.ts"

export function evaluateStagingWriteGate(featureFlags: StagingFeatureFlags): StagingWriteGate {
  const gateStates = [
    featureFlags.capabilityGates.officialProductWrite,
    featureFlags.capabilityGates.mediaLifecycle,
    featureFlags.capabilityGates.itemCorrelation,
    featureFlags.capabilityGates.variationAtomicity,
    featureFlags.capabilityGates.safeRecovery,
  ] as const

  if (gateStates.includes("unknown")) return { kind: "write_disabled", reason: "capability_unknown" }
  if (gateStates.includes("denied")) return { kind: "write_disabled", reason: "capability_denied" }
  if (!featureFlags.writePilotEnabled) return { kind: "write_disabled", reason: "feature_flag_disabled" }
  return { kind: "write_eligible" }
}

export function buildReadOnlyAlphaWorkflow(input: {
  readonly featureFlags: StagingFeatureFlags
  readonly reconciliation: StagingReconciliationSnapshot
}): ReadOnlyAlphaWorkflow {
  const writeGate = evaluateStagingWriteGate(input.featureFlags)

  return {
    organizationId: input.reconciliation.organizationId,
    environment: input.featureFlags.environment,
    writeGate,
    mutationPolicy: "blocked",
    allowedOperations: ["catalog_read", "analytics_read", "copy_preview", "reconciliation_review"],
    blockedOperations: ["media_upload", "product_create", "variation_create"],
    holdControl: determineHoldControl(writeGate, input.reconciliation),
    rollbackControl: { kind: "rollback_ready", action: "disable_write_dispatch" },
  }
}

function determineHoldControl(
  writeGate: StagingWriteGate,
  reconciliation: StagingReconciliationSnapshot,
): StagingHoldControl {
  if (writeGate.kind === "write_disabled") return { kind: "hold_active", reason: "write_gate_disabled" }

  switch (reconciliation.status) {
    case "clean":
      return { kind: "hold_released" }
    case "mismatch":
      return { kind: "hold_active", reason: "reconciliation_mismatch" }
    case "unavailable":
      return { kind: "hold_active", reason: "reconciliation_unavailable" }
    default:
      return assertNever(reconciliation.status)
  }
}

function assertNever(value: never): never {
  throw new StagingControlContractError("unexpected_reconciliation_status", String(value))
}

class StagingControlContractError extends Error {
  readonly name = "StagingControlContractError"
  readonly code: "unexpected_reconciliation_status"

  constructor(code: "unexpected_reconciliation_status", detail: string) {
    super(`Staging control received an unsupported reconciliation status: ${detail}`)
    this.code = code
  }
}
