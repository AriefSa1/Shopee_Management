import {
  AnalyticsMetricDefinitionFixtureSchema,
  AnalyticsSnapshotFixtureSchema,
  OrganizationIdSchema,
  ShopIdSchema,
  buildAnalyticsCollection,
  compareAnalyticsSnapshots,
  projectAnalyticsMetric,
} from "./index.ts"

class AnalyticsManualQaError extends Error {
  readonly name = "AnalyticsManualQaError"
  readonly reason: "snapshot_missing"

  constructor(reason: "snapshot_missing") {
    super("Analytics manual QA fixture did not create required snapshots")
    this.reason = reason
  }
}

const organizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
const shopId = ShopIdSchema.parse("30000000-0000-4000-8000-000000000001")
const definition = AnalyticsMetricDefinitionFixtureSchema.parse({
  metricDefinitionId: "item_views",
  version: 1,
  unit: "count",
  window: "rolling_30_days",
  capability: "enabled",
})
const collection = buildAnalyticsCollection({
  runId: "70000000-0000-4000-8000-000000000101",
  organizationId,
  shopId,
  definition,
  requestedProductIds: ["product-zero", "product-not-returned"],
  snapshots: [
    AnalyticsSnapshotFixtureSchema.parse({
      organizationId,
      shopId,
      productId: "product-zero",
      definition,
      collectedAt: "2026-09-09T00:00:00.000Z",
      asOf: "2026-09-09T00:00:00.000Z",
      state: "value",
      value: 0,
    }),
  ],
  startedAt: "2026-09-09T00:00:00.000Z",
  finishedAt: "2026-09-09T00:01:00.000Z",
  expectedPages: 2,
  observedPages: 1,
})
const zero = collection.snapshots.find((entry) => entry.productId === "product-zero")
const omitted = collection.snapshots.find((entry) => entry.productId === "product-not-returned")

if (zero === undefined || omitted === undefined) {
  throw new AnalyticsManualQaError("snapshot_missing")
}

console.log(
  JSON.stringify({
    scenario: "provider-fixture-analytics-absence-and-coverage",
    runStatus: collection.run.status,
    zero: projectAnalyticsMetric(zero, { now: "2026-09-09T00:05:00.000Z", maximumAgeMinutes: 10 }),
    omitted: projectAnalyticsMetric(omitted, { now: "2026-09-09T00:05:00.000Z", maximumAgeMinutes: 10 }),
    comparison: compareAnalyticsSnapshots({
      left: zero,
      leftRun: collection.run,
      right: omitted,
      rightRun: collection.run,
      now: "2026-09-09T00:05:00.000Z",
      maximumAgeMinutes: 10,
    }),
    networkCalls: 0,
    secretFieldsPresent: false,
  }),
)
