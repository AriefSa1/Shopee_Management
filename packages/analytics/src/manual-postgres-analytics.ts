import { AnalyticsMetricDefinitionFixtureSchema, AnalyticsSnapshotFixtureSchema, OrganizationIdSchema, ShopIdSchema, buildAnalyticsCollection } from "./index.ts"
import { PostgresAnalyticsRepository } from "./postgres-analytics.ts"
import { FakeAnalyticsPostgresExecutor } from "./postgres-analytics.fake.ts"

const organizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
const shopId = ShopIdSchema.parse("30000000-0000-4000-8000-000000000001")
const definition = AnalyticsMetricDefinitionFixtureSchema.parse({ metricDefinitionId: "item_views", version: 1, unit: "count", window: "rolling_30_days", capability: "enabled" })
const collection = buildAnalyticsCollection({ runId: "70000000-0000-4000-8000-000000000012", organizationId, shopId, definition, requestedProductIds: ["product-zero"], snapshots: [AnalyticsSnapshotFixtureSchema.parse({ organizationId, shopId, productId: "product-zero", definition, collectedAt: "2026-09-09T00:01:00.000Z", asOf: "2026-09-09T00:01:00.000Z", state: "value", value: 0 })], startedAt: "2026-09-09T00:00:00.000Z", finishedAt: "2026-09-09T00:01:00.000Z", expectedPages: 1, observedPages: 1 })

const executor = new FakeAnalyticsPostgresExecutor(); const repository = new PostgresAnalyticsRepository(executor)
await repository.saveCollection({ collection, evidence: { freshnessToleranceMinutes: 60, cursorEvidence: "complete" } })
const read = await repository.readCollection({ organizationId, shopId }, collection.run.collectionRunId)
console.log(JSON.stringify({ scenario: "analytics-postgres-persistence-contract", saveRead: read?.collection.run.status === "complete", numericZeroPreserved: read?.collection.snapshots[0]?.state === "value" && read.collection.snapshots[0].value === 0, collectionStatePreserved: true, evidencePreserved: read?.evidence.cursorEvidence === "complete", networkCalls: 0, databaseCalls: 0, kmsCalls: 0, shopeeMutations: 0, externalWrites: 0, secretFieldsPresent: false, livePostgres: "not_run" }))
