import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  OrganizationIdSchema,
  ShopIdSchema,
  PilotMeasurementCaptureSchema,
  StagingFeatureFlagsSchema,
  StagingReconciliationSnapshotSchema,
  buildReadOnlyAlphaWorkflow,
  evaluatePilotMeasurement,
  evaluateStagingWriteGate,
} from "./index.ts"

const organizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
const shopId = ShopIdSchema.parse("30000000-0000-4000-8000-000000000001")

function flags(capabilityState: "verified" | "unknown" | "denied", writePilotEnabled = true) {
  return StagingFeatureFlagsSchema.parse({
    environment: "staging",
    writePilotEnabled,
    capabilityGates: {
      officialProductWrite: capabilityState,
      mediaLifecycle: "verified",
      itemCorrelation: "verified",
      variationAtomicity: "verified",
      safeRecovery: "verified",
    },
  })
}

function reconciliation(status: "clean" | "mismatch" | "unavailable") {
  return StagingReconciliationSnapshotSchema.parse({
    organizationId,
    shopId,
    collectedAt: "2026-09-09T00:00:00.000Z",
    status,
    expectedDestinationCount: 2,
    observedDestinationCount: status === "clean" ? 2 : 1,
  })
}

describe("staging write gate contracts", () => {
  it("fails closed when any required capability is unknown", () => {
    // Given: a staging feature flag where the official product-write capability is still unknown.
    const featureFlags = flags("unknown")

    // When: the pilot write gate is evaluated.
    const decision = evaluateStagingWriteGate(featureFlags)

    // Then: write access stays disabled without scheduling an upstream operation.
    assert.deepEqual(decision, { kind: "write_disabled", reason: "capability_unknown" })
  })

  it("keeps the read-only alpha workflow blocked even when all capability gates are verified", () => {
    // Given: every capability gate is verified and the future pilot flag is enabled.
    const featureFlags = flags("verified")

    // When: the alpha runbook is built before user-approved pilot activation.
    const workflow = buildReadOnlyAlphaWorkflow({
      featureFlags,
      reconciliation: reconciliation("clean"),
    })

    // Then: the gate is eligible but this alpha surface remains read-only and blocks mutation dispatch.
    assert.equal(workflow.writeGate.kind, "write_eligible")
    assert.equal(workflow.mutationPolicy, "blocked")
    assert.deepEqual(workflow.blockedOperations, ["media_upload", "product_create", "variation_create"])
  })

  it("activates a hold and provides a rollback-to-hold control when reconciliation has a mismatch", () => {
    // Given: verified feature flags paired with an observed reconciliation mismatch.
    const featureFlags = flags("verified")

    // When: the read-only alpha runbook evaluates its operational controls.
    const workflow = buildReadOnlyAlphaWorkflow({
      featureFlags,
      reconciliation: reconciliation("mismatch"),
    })

    // Then: operations remain on hold and rollback only disables future dispatch.
    assert.deepEqual(workflow.holdControl, { kind: "hold_active", reason: "reconciliation_mismatch" })
    assert.deepEqual(workflow.rollbackControl, { kind: "rollback_ready", action: "disable_write_dispatch" })
  })
})

describe("pilot measurement contracts", () => {
  it("rejects a caller-selected target below the agreed 50% threshold", () => {
    assert.throws(() => PilotMeasurementCaptureSchema.parse({
      organizationId,
      capturedAt: "2026-09-09T00:00:00.000Z",
      workflow: "multi_store_product_management",
      baselineMinutes: 30,
      observedMinutes: 12,
      sampleCount: 3,
      targetReductionPercent: 49,
    }), /50%/)
  })

  it("captures the time-reduction outcome against the agreed target", () => {
    // Given: a 30-minute baseline and a 12-minute pilot observation across a valid sample.
    const capture = PilotMeasurementCaptureSchema.parse({
      organizationId,
      capturedAt: "2026-09-09T00:00:00.000Z",
      workflow: "multi_store_product_management",
      baselineMinutes: 30,
      observedMinutes: 12,
      sampleCount: 10,
      targetReductionPercent: 50,
    })

    // When: the pilot measurement is evaluated.
    const outcome = evaluatePilotMeasurement(capture)

    // Then: the measured 60% reduction satisfies the pilot target without claiming live deployment.
    assert.deepEqual(outcome, { kind: "target_met", reductionPercent: 60, targetReductionPercent: 50 })
  })
})
