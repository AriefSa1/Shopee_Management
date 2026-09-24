import {
  AnalyticsCollectionRunIdSchema,
  AnalyticsProductIdSchema,
  AnalyticsSnapshotFixtureSchema,
  AnalyticsTimestampSchema,
  type AnalyticsCollection,
  type AnalyticsCollectionRun,
  type AnalyticsMetricDefinition,
  type AnalyticsProductId,
  type AnalyticsSnapshot,
  type AnalyticsSnapshotFixture,
  type OrganizationId,
  type ShopId,
} from "./model.ts"

export type BuildAnalyticsCollectionInput = {
  readonly runId: string
  readonly organizationId: OrganizationId
  readonly shopId: ShopId
  readonly definition: AnalyticsMetricDefinition
  readonly requestedProductIds: readonly string[]
  readonly snapshots: readonly AnalyticsSnapshotFixture[]
  readonly startedAt: string
  readonly finishedAt: string
  readonly expectedPages: number
  readonly observedPages: number
}

export function buildAnalyticsCollection(input: BuildAnalyticsCollectionInput): AnalyticsCollection {
  const run = buildRun(input)
  const requestedProductIds = run.requestedProductIds
  const received = new Map<AnalyticsProductId, AnalyticsSnapshot>()

  for (const fixture of input.snapshots) {
    const snapshot = AnalyticsSnapshotFixtureSchema.parse(fixture)
    if (snapshot.organizationId !== run.organizationId) {
      throw new AnalyticsCollectionContractError("snapshot_organization_mismatch")
    }
    if (snapshot.shopId !== run.shopId) {
      throw new AnalyticsCollectionContractError("snapshot_shop_mismatch")
    }
    if (!requestedProductIds.includes(snapshot.productId)) {
      throw new AnalyticsCollectionContractError("snapshot_product_not_requested")
    }
    if (!definitionsMatch(snapshot.definition, run.definition)) {
      throw new AnalyticsCollectionContractError("snapshot_metric_definition_mismatch")
    }
    if (received.has(snapshot.productId)) {
      throw new AnalyticsCollectionContractError("duplicate_product_snapshot")
    }
    received.set(snapshot.productId, { ...snapshot, collectionRunId: run.collectionRunId })
  }

  const snapshots = requestedProductIds.map((productId) => {
    const receivedSnapshot = received.get(productId)
    return receivedSnapshot ?? notReturnedSnapshot({ productId, run })
  })
  const completeRunHasMissingProducts = run.status === "complete" && snapshots.some((snapshot) => snapshot.state === "not_returned")
  return { run: completeRunHasMissingProducts ? { ...run, status: "partial" } : run, snapshots }
}

function buildRun(input: BuildAnalyticsCollectionInput): AnalyticsCollectionRun {
  const collectionRunId = AnalyticsCollectionRunIdSchema.parse(input.runId)
  const requestedProductIds = uniqueProductIds(input.requestedProductIds)
  const startedAt = AnalyticsTimestampSchema.parse(input.startedAt)
  const finishedAt = AnalyticsTimestampSchema.parse(input.finishedAt)
  const expectedPages = nonnegativePageCount(input.expectedPages)
  const observedPages = nonnegativePageCount(input.observedPages)
  if (Date.parse(finishedAt) < Date.parse(startedAt) || observedPages > expectedPages) {
    return {
      collectionRunId,
      organizationId: input.organizationId,
      shopId: input.shopId,
      definition: input.definition,
      requestedProductIds,
      startedAt,
      finishedAt,
      expectedPages,
      observedPages,
      status: "failed",
    }
  }
  return {
    collectionRunId,
    organizationId: input.organizationId,
    shopId: input.shopId,
    definition: input.definition,
    requestedProductIds,
    startedAt,
    finishedAt,
    expectedPages,
    observedPages,
    status: observedPages === expectedPages ? "complete" : "partial",
  }
}

function uniqueProductIds(rawProductIds: readonly string[]): readonly AnalyticsProductId[] {
  const productIds = rawProductIds.map((productId) => AnalyticsProductIdSchema.parse(productId))
  if (new Set(productIds).size !== productIds.length) {
    throw new AnalyticsCollectionContractError("duplicate_requested_product")
  }
  return productIds
}

function nonnegativePageCount(value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new AnalyticsCollectionContractError("invalid_page_count")
  }
  return value
}

function definitionsMatch(
  left: AnalyticsMetricDefinition,
  right: AnalyticsMetricDefinition,
): boolean {
  return (
    left.metricDefinitionId === right.metricDefinitionId &&
    left.version === right.version &&
    left.unit === right.unit &&
    left.window === right.window &&
    left.capability === right.capability
  )
}

function notReturnedSnapshot(input: {
  readonly productId: AnalyticsProductId
  readonly run: AnalyticsCollectionRun
}): AnalyticsSnapshot {
  return {
    collectionRunId: input.run.collectionRunId,
    organizationId: input.run.organizationId,
    shopId: input.run.shopId,
    productId: input.productId,
    definition: input.run.definition,
    collectedAt: input.run.finishedAt,
    asOf: input.run.finishedAt,
    state: "not_returned",
  }
}

export class AnalyticsCollectionContractError extends Error {
  readonly name = "AnalyticsCollectionContractError"
  readonly reason:
    | "snapshot_organization_mismatch"
    | "snapshot_shop_mismatch"
    | "snapshot_product_not_requested"
    | "snapshot_metric_definition_mismatch"
    | "duplicate_product_snapshot"
    | "duplicate_requested_product"
    | "invalid_page_count"

  constructor(reason: AnalyticsCollectionContractError["reason"]) {
    super("Analytics collection fixture violated a deterministic contract")
    this.reason = reason
  }
}
