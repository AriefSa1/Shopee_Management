import { AnalyticsCollectionRunIdSchema, AnalyticsMetricDefinitionFixtureSchema, AnalyticsProductIdSchema, AnalyticsSnapshotFixtureSchema, OrganizationIdSchema, ShopIdSchema } from "./index.ts"
import { createAnalyticsApiHandler, type AnalyticsApiDependencies } from "./analytics-api.ts"

const organizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
const shopId = ShopIdSchema.parse("30000000-0000-4000-8000-000000000001")
const definition = AnalyticsMetricDefinitionFixtureSchema.parse({ metricDefinitionId: "item_views", version: 1, unit: "count", window: "rolling_30_days", capability: "enabled" })
const runId = AnalyticsCollectionRunIdSchema.parse("70000000-0000-4000-8000-000000000001")
const productId = AnalyticsProductIdSchema.parse("manual-zero")
const collection = {
  run: { collectionRunId: runId, organizationId, shopId, definition, requestedProductIds: [productId], startedAt: "2026-09-09T00:00:00.000Z", finishedAt: "2026-09-09T00:01:00.000Z", expectedPages: 1, observedPages: 1, status: "complete" as const },
  snapshots: [{ ...AnalyticsSnapshotFixtureSchema.parse({ organizationId, shopId, productId, definition, collectedAt: "2026-09-09T00:01:00.000Z", asOf: "2026-09-09T00:01:00.000Z", state: "value", value: 0 }), collectionRunId: runId }],
}
const dependencies: AnalyticsApiDependencies = { authenticate: () => ({ organizationId, accessibleShopIds: [shopId] }), read: async () => collection }
const response = await createAnalyticsApiHandler(new Request(`https://app.test/api/analytics?organizationId=${organizationId}&shopId=${shopId}&productId=manual-zero&now=2026-09-09T00:05:00.000Z&maximumAgeMinutes=10`, { headers: { authorization: "Bearer manual-test-token" } }), dependencies)
console.log(JSON.stringify({ status: response.status, body: await response.json(), networkCalls: 0, databaseCalls: 0, shopeeMutations: 0, secretFieldsPresent: false, writeEnabled: false }))
