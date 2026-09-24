import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  AnalyticsCollectionRunIdSchema,
  AnalyticsMetricDefinitionFixtureSchema,
  AnalyticsSnapshotFixtureSchema,
  OrganizationIdSchema,
  ShopIdSchema,
  buildAnalyticsCollection,
  compareAnalyticsSnapshots,
  projectAnalyticsMetric,
} from "./index.ts"

const organizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
const shopId = ShopIdSchema.parse("30000000-0000-4000-8000-000000000001")
const secondShopId = ShopIdSchema.parse("30000000-0000-4000-8000-000000000002")
const fixtureCollectionRunId = AnalyticsCollectionRunIdSchema.parse("70000000-0000-4000-8000-000000000001")
const definition = AnalyticsMetricDefinitionFixtureSchema.parse({
  metricDefinitionId: "item_views",
  version: 1,
  unit: "count",
  window: "rolling_30_days",
  capability: "enabled",
})
function snapshot(input: {
  readonly productId: string
  readonly shopId?: string
  readonly value?: number
  readonly state?: "missing" | "not_returned"
}) {
  return AnalyticsSnapshotFixtureSchema.parse({
    organizationId,
    shopId: input.shopId ?? shopId,
    productId: input.productId,
    definition,
    collectedAt: "2026-09-09T00:00:00.000Z",
    asOf: "2026-09-09T00:00:00.000Z",
    ...(input.value === undefined ? { state: input.state ?? "missing" } : { state: "value", value: input.value }),
  })
}

function snapshotWithRunId(input: Parameters<typeof snapshot>[0]) {
  return { ...snapshot(input), collectionRunId: fixtureCollectionRunId }
}

describe("analytics collection contracts", () => {
  it("preserves an upstream zero as a value and never coerces it to absence", () => {
    // Given: a complete fixture run where an enabled metric explicitly returns zero.
    const result = buildAnalyticsCollection({
      runId: "70000000-0000-4000-8000-000000000001",
      organizationId,
      shopId,
      definition,
      requestedProductIds: ["product-zero"],
      snapshots: [snapshot({ productId: "product-zero", value: 0 })],
      startedAt: "2026-09-09T00:00:00.000Z",
      finishedAt: "2026-09-09T00:01:00.000Z",
      expectedPages: 1,
      observedPages: 1,
    })

    // When: the result is projected for the analytics API/domain surface.
    const observedSnapshot = result.snapshots[0]
    assert.ok(observedSnapshot)
    const metric = projectAnalyticsMetric(observedSnapshot, {
      now: "2026-09-09T00:05:00.000Z",
      maximumAgeMinutes: 10,
    })

    // Then: the zero remains a meaningful numeric measurement with its source window.
    assert.deepEqual(result.run.status, "complete")
    assert.deepEqual(metric, { kind: "value", value: 0, unit: "count", window: "rolling_30_days" })
  })

  it("marks an absent supported field missing only after a complete collection", () => {
    // Given: a complete run whose returned item lacks an otherwise enabled metric field.
    const result = buildAnalyticsCollection({
      runId: "70000000-0000-4000-8000-000000000002",
      organizationId,
      shopId,
      definition,
      requestedProductIds: ["product-missing"],
      snapshots: [snapshot({ productId: "product-missing", state: "missing" })],
      startedAt: "2026-09-09T00:00:00.000Z",
      finishedAt: "2026-09-09T00:01:00.000Z",
      expectedPages: 1,
      observedPages: 1,
    })

    // When: the snapshot is projected inside its fresh window.
    const observedSnapshot = result.snapshots[0]
    assert.ok(observedSnapshot)
    const metric = projectAnalyticsMetric(observedSnapshot, {
      now: "2026-09-09T00:05:00.000Z",
      maximumAgeMinutes: 10,
    })

    // Then: the API states absence, rather than inventing a zero.
    assert.deepEqual(metric, { kind: "missing" })
  })

  it("converts incomplete-run omissions into not-returned rather than missing", () => {
    // Given: a requested product omitted after one expected page is absent.
    const result = buildAnalyticsCollection({
      runId: "70000000-0000-4000-8000-000000000003",
      organizationId,
      shopId,
      definition,
      requestedProductIds: ["product-observed", "product-not-returned"],
      snapshots: [snapshot({ productId: "product-observed", value: 4 })],
      startedAt: "2026-09-09T00:00:00.000Z",
      finishedAt: "2026-09-09T00:01:00.000Z",
      expectedPages: 2,
      observedPages: 1,
    })

    // When: the partial collection materializes the required product snapshots.
    const omitted = result.snapshots.find((entry) => entry.productId === "product-not-returned")

    // Then: the run and omission both retain their incomplete semantics.
    assert.deepEqual(result.run.status, "partial")
    assert.notEqual(omitted, undefined)
    assert.equal(omitted?.shopId, shopId)
    assert.deepEqual(
      omitted === undefined
        ? undefined
        : projectAnalyticsMetric(omitted, { now: "2026-09-09T00:05:00.000Z", maximumAgeMinutes: 10 }),
      { kind: "not_returned" },
    )
  })

  it("downgrades page-complete runs when a requested product was not returned", () => {
    const result = buildAnalyticsCollection({
      runId: "70000000-0000-4000-8000-000000000013",
      organizationId,
      shopId,
      definition,
      requestedProductIds: ["product-observed", "product-not-returned"],
      snapshots: [snapshot({ productId: "product-observed", value: 4 })],
      startedAt: "2026-09-09T00:00:00.000Z",
      finishedAt: "2026-09-09T00:01:00.000Z",
      expectedPages: 1,
      observedPages: 1,
    })

    assert.equal(result.run.status, "partial")
    assert.equal(result.snapshots[1]?.state, "not_returned")
  })

  it("exposes unsupported capability separately from a missing field", () => {
    // Given: a metric definition disabled for this app/market capability version.
    const unsupportedDefinition = AnalyticsMetricDefinitionFixtureSchema.parse({ ...definition, capability: "unsupported" })
    const unsupported = AnalyticsSnapshotFixtureSchema.parse({
      organizationId,
      shopId,
      productId: "product-unsupported",
      definition: unsupportedDefinition,
      collectedAt: "2026-09-09T00:00:00.000Z",
      asOf: "2026-09-09T00:00:00.000Z",
      state: "unsupported",
    })
    const unsupportedSnapshot = { ...unsupported, collectionRunId: fixtureCollectionRunId }

    // When: the snapshot is projected.
    const metric = projectAnalyticsMetric(unsupportedSnapshot, {
      now: "2026-09-09T00:05:00.000Z",
      maximumAgeMinutes: 10,
    })

    // Then: consumers can label capability absence without treating it as a product result.
    assert.deepEqual(metric, { kind: "unsupported", capability: "unsupported" })
  })

  it("rejects an unsupported state when the metric capability is enabled", () => {
    // Given: an enabled definition paired with an impossible unsupported snapshot state.
    const parseContradiction = (): void => {
      AnalyticsSnapshotFixtureSchema.parse({
        organizationId,
        shopId,
        productId: "product-contradiction",
        definition,
        collectedAt: "2026-09-09T00:00:00.000Z",
        asOf: "2026-09-09T00:00:00.000Z",
        state: "unsupported",
      })
    }

    // When: the provider fixture crosses the typed analytics boundary.
    // Then: invalid capability evidence is rejected rather than projected as a truthful absence state.
    assert.throws(parseContradiction)
  })

  it("labels aged values stale without discarding their source timestamp", () => {
    // Given: an otherwise valid measurement older than the supplied tolerance.
    const aged = snapshotWithRunId({ productId: "product-aged", value: 9 })

    // When: a deterministic later clock renders the metric.
    const metric = projectAnalyticsMetric(aged, {
      now: "2026-09-09T00:11:00.000Z",
      maximumAgeMinutes: 10,
    })

    // Then: the API exposes stale state and the last source timestamp instead of claiming freshness.
    assert.deepEqual(metric, { kind: "stale", asOf: "2026-09-09T00:00:00.000Z" })
  })
})

describe("analytics comparison contracts", () => {
  it("allows comparison only for complete, fresh, compatible numeric snapshots", () => {
    // Given: two same-definition values from complete compatible collections.
    const left = buildAnalyticsCollection({
      runId: "70000000-0000-4000-8000-000000000004",
      organizationId,
      shopId,
      definition,
      requestedProductIds: ["product-left"],
      snapshots: [snapshot({ productId: "product-left", value: 3 })],
      startedAt: "2026-09-09T00:00:00.000Z",
      finishedAt: "2026-09-09T00:01:00.000Z",
      expectedPages: 1,
      observedPages: 1,
    })
    const right = buildAnalyticsCollection({
      runId: "70000000-0000-4000-8000-000000000005",
      organizationId,
      shopId: secondShopId,
      definition,
      requestedProductIds: ["product-right"],
      snapshots: [snapshot({ productId: "product-right", shopId: secondShopId, value: 8 })],
      startedAt: "2026-09-09T00:00:00.000Z",
      finishedAt: "2026-09-09T00:01:00.000Z",
      expectedPages: 1,
      observedPages: 1,
    })

    // When: the comparison gate evaluates both snapshots against one deterministic clock.
    const leftSnapshot = left.snapshots[0]
    const rightSnapshot = right.snapshots[0]
    assert.ok(leftSnapshot)
    assert.ok(rightSnapshot)
    const comparison = compareAnalyticsSnapshots({
      left: leftSnapshot,
      leftRun: left.run,
      right: rightSnapshot,
      rightRun: right.run,
      now: "2026-09-09T00:05:00.000Z",
      maximumAgeMinutes: 10,
    })

    // Then: it releases a numeric delta only after every compatibility condition holds.
    assert.deepEqual(comparison, { kind: "eligible", delta: 5, unit: "count", window: "rolling_30_days" })
  })

  it("denies comparison for partial collection coverage before calculating a delta", () => {
    // Given: one otherwise matching snapshot belongs to a partial run.
    const complete = buildAnalyticsCollection({
      runId: "70000000-0000-4000-8000-000000000006",
      organizationId,
      shopId,
      definition,
      requestedProductIds: ["product-complete"],
      snapshots: [snapshot({ productId: "product-complete", value: 3 })],
      startedAt: "2026-09-09T00:00:00.000Z",
      finishedAt: "2026-09-09T00:01:00.000Z",
      expectedPages: 1,
      observedPages: 1,
    })
    const partial = buildAnalyticsCollection({
      runId: "70000000-0000-4000-8000-000000000007",
      organizationId,
      shopId,
      definition,
      requestedProductIds: ["product-partial", "product-not-returned"],
      snapshots: [snapshot({ productId: "product-partial", value: 8 })],
      startedAt: "2026-09-09T00:00:00.000Z",
      finishedAt: "2026-09-09T00:01:00.000Z",
      expectedPages: 2,
      observedPages: 1,
    })

    // When: the comparison boundary receives the partial collection.
    const completeSnapshot = complete.snapshots[0]
    const partialSnapshot = partial.snapshots[0]
    assert.ok(completeSnapshot)
    assert.ok(partialSnapshot)
    const comparison = compareAnalyticsSnapshots({
      left: completeSnapshot,
      leftRun: complete.run,
      right: partialSnapshot,
      rightRun: partial.run,
      now: "2026-09-09T00:05:00.000Z",
      maximumAgeMinutes: 10,
    })

    // Then: it denies the comparison without claiming an aggregate over missing coverage.
    assert.deepEqual(comparison, { kind: "ineligible", reason: "collection_incomplete" })
  })
})
