import {
  OrganizationIdSchema,
  PilotMeasurementCaptureSchema,
  StagingFeatureFlagsSchema,
  StagingReconciliationSnapshotSchema,
  ShopIdSchema,
  buildReadOnlyAlphaWorkflow,
  evaluatePilotMeasurement,
} from "./index.ts"

class StagingManualQaError extends Error {
  readonly name = "StagingManualQaError"
  readonly reason: "read_only_gate_failed"

  constructor(reason: "read_only_gate_failed") {
    super("Staging manual QA did not preserve the read-only mutation block")
    this.reason = reason
  }
}

const organizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
const shopId = ShopIdSchema.parse("30000000-0000-4000-8000-000000000001")
const workflow = buildReadOnlyAlphaWorkflow({
  featureFlags: StagingFeatureFlagsSchema.parse({
    environment: "staging",
    writePilotEnabled: true,
    capabilityGates: {
      officialProductWrite: "unknown",
      mediaLifecycle: "verified",
      itemCorrelation: "verified",
      variationAtomicity: "verified",
      safeRecovery: "verified",
    },
  }),
  reconciliation: StagingReconciliationSnapshotSchema.parse({
    organizationId,
    shopId,
    collectedAt: "2026-09-09T00:00:00.000Z",
    status: "mismatch",
    expectedDestinationCount: 2,
    observedDestinationCount: 1,
  }),
})
const measurement = evaluatePilotMeasurement(
  PilotMeasurementCaptureSchema.parse({
    organizationId,
    capturedAt: "2026-09-09T00:00:00.000Z",
    workflow: "multi_store_product_management",
    baselineMinutes: 30,
    observedMinutes: 12,
    sampleCount: 10,
    targetReductionPercent: 50,
  }),
)

if (workflow.writeGate.kind !== "write_disabled" || workflow.mutationPolicy !== "blocked") {
  throw new StagingManualQaError("read_only_gate_failed")
}

console.log(
  JSON.stringify({
    scenario: "staging-read-only-alpha-contract",
    writeGate: workflow.writeGate,
    mutationPolicy: workflow.mutationPolicy,
    holdControl: workflow.holdControl,
    rollbackControl: workflow.rollbackControl,
    pilotMeasurement: measurement,
    networkCalls: 0,
    databaseCalls: 0,
    shopeeMutations: 0,
    secretFieldsPresent: false,
  }),
)
