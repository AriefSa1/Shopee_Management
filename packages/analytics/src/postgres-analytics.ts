import { z } from "zod"
import {
  AnalyticsCollectionRunIdSchema,
  AnalyticsMetricDefinitionFixtureSchema,
  AnalyticsProductIdSchema,
  AnalyticsSnapshotFixtureSchema,
  AnalyticsTimestampSchema,
  type AnalyticsProductId,
  OrganizationIdSchema,
  ShopIdSchema,
  type AnalyticsCollection,
  type AnalyticsSnapshot,
} from "./model.ts"
import type { OrganizationId, ShopId } from "../../identity/src/model.ts"
import type { PostgresExecutor, SqlRow } from "../../delivery/src/postgres-delivery.ts"

export type AnalyticsCollectionScope = { readonly organizationId: OrganizationId; readonly shopId: ShopId }
export type AnalyticsCursorEvidence = "complete" | "missing_page" | "cursor_repeated" | "response_mismatch" | "incompatible_capability" | "invalid_collection"
export type AnalyticsPersistenceEvidence = {
  readonly freshnessToleranceMinutes: number
  readonly cursorEvidence: AnalyticsCursorEvidence
}
export type AnalyticsCollectionRecord = { readonly collection: AnalyticsCollection; readonly evidence: AnalyticsPersistenceEvidence }

export class AnalyticsPersistenceError extends Error {
  readonly name = "AnalyticsPersistenceError"
  readonly code: "invalid_row" | "scope_mismatch"
  constructor(code: AnalyticsPersistenceError["code"]) {
    super(`Analytics persistence rejected the request: ${code}`)
    this.code = code
  }
}

export class PostgresAnalyticsRepository {
  private readonly executor: PostgresExecutor

  constructor(executor: PostgresExecutor) {
    this.executor = executor
  }

  saveCollection(record: AnalyticsCollectionRecord): Promise<void> {
    return this.executor.transaction(async (tx) => {
      const collection = record.collection
      const runId = AnalyticsCollectionRunIdSchema.parse(collection.run.collectionRunId)
      const definition = AnalyticsMetricDefinitionFixtureSchema.parse(collection.run.definition)
      const requestedProductIds = collection.run.requestedProductIds.map((id) => AnalyticsProductIdSchema.parse(id))
      if (!Number.isInteger(record.evidence.freshnessToleranceMinutes) || record.evidence.freshnessToleranceMinutes < 0) throw new AnalyticsPersistenceError("invalid_row")
      const cursorEvidence = z.enum(["complete", "missing_page", "cursor_repeated", "response_mismatch", "incompatible_capability", "invalid_collection"]).parse(record.evidence.cursorEvidence)
      if (collection.run.status === "complete" && cursorEvidence !== "complete") throw new AnalyticsPersistenceError("invalid_row")
      const returnedSnapshots = collection.snapshots.filter((snapshot) => snapshot.state !== "not_returned")
      const asOfValues = collection.snapshots.map((snapshot) => snapshot.asOf).sort()
      const asOfMin = asOfValues[0] ?? null
      const asOfMax = asOfValues.at(-1) ?? null
      await tx.query({
        name: "analytics.collection_run.insert",
        text: `INSERT INTO analytics_collection_runs (
          collection_run_id, organization_id, shop_id, metric_definition_id, metric_version,
          metric_unit, metric_window, metric_capability, requested_product_ids,
          started_at, finished_at, as_of_min, as_of_max, freshness_tolerance_minutes,
          expected_pages, observed_pages, expected_items, observed_items, cursor_evidence, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
        params: [runId, collection.run.organizationId, collection.run.shopId, definition.metricDefinitionId, definition.version, definition.unit, definition.window, definition.capability, JSON.stringify(requestedProductIds), collection.run.startedAt, collection.run.finishedAt, asOfMin, asOfMax, record.evidence.freshnessToleranceMinutes, collection.run.expectedPages, collection.run.observedPages, requestedProductIds.length, returnedSnapshots.length, cursorEvidence, collection.run.status],
      })
      for (const snapshot of collection.snapshots) {
        const { collectionRunId: snapshotRunId, ...fixture } = snapshot
        if (snapshotRunId !== runId) throw new AnalyticsPersistenceError("scope_mismatch")
        const parsed = AnalyticsSnapshotFixtureSchema.parse(fixture)
        if (parsed.organizationId !== collection.run.organizationId || parsed.shopId !== collection.run.shopId) {
          throw new AnalyticsPersistenceError("scope_mismatch")
        }
        await tx.query({
          name: "analytics.metric_snapshot.insert",
          text: `INSERT INTO analytics_metric_snapshots (
            collection_run_id, organization_id, shop_id, product_id,
            metric_definition_id, metric_version, metric_unit, metric_window,
            metric_capability, state, value, collected_at, as_of
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          params: [runId, parsed.organizationId, parsed.shopId, parsed.productId, parsed.definition.metricDefinitionId, parsed.definition.version, parsed.definition.unit, parsed.definition.window, parsed.definition.capability, parsed.state, parsed.state === "value" ? parsed.value : null, parsed.collectedAt, parsed.asOf],
        })
      }
    })
  }

  async readCollection(scope: AnalyticsCollectionScope, collectionRunId: string): Promise<AnalyticsCollectionRecord | null> {
    const runId = AnalyticsCollectionRunIdSchema.parse(collectionRunId)
    const rows = await this.executor.query({
      name: "analytics.collection.read",
      text: `SELECT r.collection_run_id, r.organization_id, r.shop_id,
        r.metric_definition_id AS run_metric_definition_id, r.metric_version AS run_metric_version,
        r.metric_unit AS run_metric_unit, r.metric_window AS run_metric_window,
        r.metric_capability AS run_metric_capability, r.requested_product_ids,
        r.started_at, r.finished_at, r.as_of_min, r.as_of_max, r.freshness_tolerance_minutes,
        r.expected_pages, r.observed_pages, r.expected_items, r.observed_items, r.cursor_evidence, r.status,
        s.product_id, s.metric_definition_id, s.metric_version, s.metric_unit,
        s.metric_window, s.metric_capability, s.state, s.value, s.collected_at, s.as_of
      FROM analytics_collection_runs AS r
      LEFT JOIN analytics_metric_snapshots AS s
        ON s.collection_run_id = r.collection_run_id
        AND s.organization_id = r.organization_id AND s.shop_id = r.shop_id
      WHERE r.organization_id = $1 AND r.shop_id = $2 AND r.collection_run_id = $3
      ORDER BY s.product_id`,
      params: [scope.organizationId, scope.shopId, runId],
    })
    if (rows.length === 0) return null
    return mapCollection(rows)
  }
}

function mapCollection(rows: readonly SqlRow[]): AnalyticsCollectionRecord {
  const first = rows[0]
  if (first === undefined) throw new AnalyticsPersistenceError("invalid_row")
  const organizationId = OrganizationIdSchema.parse(requiredString(first, "organization_id"))
  const shopId = ShopIdSchema.parse(requiredString(first, "shop_id"))
  const definition = AnalyticsMetricDefinitionFixtureSchema.parse({
    metricDefinitionId: requiredString(first, "run_metric_definition_id"),
    version: requiredNumber(first, "run_metric_version"),
    unit: requiredString(first, "run_metric_unit"),
    window: requiredString(first, "run_metric_window"),
    capability: requiredString(first, "run_metric_capability"),
  })
  const requestedProductIds = parseRequestedProductIds(first["requested_product_ids"])
  const snapshots: AnalyticsSnapshot[] = []
  for (const row of rows) {
    if (row["product_id"] === null || row["product_id"] === undefined) continue
    const snapshot = AnalyticsSnapshotFixtureSchema.parse({
      organizationId,
      shopId,
      productId: requiredString(row, "product_id"),
      definition: {
        metricDefinitionId: requiredString(row, "metric_definition_id"),
        version: requiredNumber(row, "metric_version"),
        unit: requiredString(row, "metric_unit"),
        window: requiredString(row, "metric_window"),
        capability: requiredString(row, "metric_capability"),
      },
      collectedAt: AnalyticsTimestampSchema.parse(requiredString(row, "collected_at")),
      asOf: AnalyticsTimestampSchema.parse(requiredString(row, "as_of")),
      state: requiredString(row, "state"),
      ...(row["state"] === "value" ? { value: requiredNumber(row, "value") } : {}),
    })
    snapshots.push({ ...snapshot, collectionRunId: AnalyticsCollectionRunIdSchema.parse(requiredString(first, "collection_run_id")) })
  }
  const collection: AnalyticsCollection = {
    run: {
      collectionRunId: AnalyticsCollectionRunIdSchema.parse(requiredString(first, "collection_run_id")),
      organizationId,
      shopId,
      definition,
      requestedProductIds,
      startedAt: AnalyticsTimestampSchema.parse(requiredString(first, "started_at")),
      finishedAt: AnalyticsTimestampSchema.parse(requiredString(first, "finished_at")),
      expectedPages: requiredNumber(first, "expected_pages"),
      observedPages: requiredNumber(first, "observed_pages"),
      status: z.enum(["complete", "partial", "failed"]).parse(requiredString(first, "status")),
    },
    snapshots,
  }
  return {
    collection,
    evidence: {
      freshnessToleranceMinutes: requiredNumber(first, "freshness_tolerance_minutes"),
      cursorEvidence: z.enum(["complete", "missing_page", "cursor_repeated", "response_mismatch", "incompatible_capability", "invalid_collection"]).parse(requiredString(first, "cursor_evidence")),
    },
  }
}

function requiredString(row: SqlRow, key: string): string {
  const value = row[key]
  if (typeof value !== "string") throw new AnalyticsPersistenceError("invalid_row")
  return value
}

function requiredNumber(row: SqlRow, key: string): number {
  const value = row[key]
  if (typeof value !== "number" || !Number.isFinite(value)) throw new AnalyticsPersistenceError("invalid_row")
  return value
}

function parseRequestedProductIds(value: unknown): readonly AnalyticsProductId[] {
  if (typeof value !== "string") throw new AnalyticsPersistenceError("invalid_row")
  const parsed: unknown = JSON.parse(value)
  if (!Array.isArray(parsed)) throw new AnalyticsPersistenceError("invalid_row")
  return parsed.map((entry) => AnalyticsProductIdSchema.parse(entry))
}
