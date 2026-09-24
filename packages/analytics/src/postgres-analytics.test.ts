import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { AnalyticsCollectionRunIdSchema, AnalyticsMetricDefinitionFixtureSchema, AnalyticsSnapshotFixtureSchema, OrganizationIdSchema, ShopIdSchema, buildAnalyticsCollection } from "./index.ts"
import { PostgresAnalyticsRepository } from "./postgres-analytics.ts"
import { FakeAnalyticsPostgresExecutor } from "./postgres-analytics.fake.ts"

const organizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
const otherOrganizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000009")
const shopId = ShopIdSchema.parse("30000000-0000-4000-8000-000000000001")
const runId = "70000000-0000-4000-8000-000000000011"
const definition = AnalyticsMetricDefinitionFixtureSchema.parse({ metricDefinitionId: "item_views", version: 1, unit: "count", window: "rolling_30_days", capability: "enabled" })

function collection() {
  return buildAnalyticsCollection({ runId, organizationId, shopId, definition, requestedProductIds: ["product-zero", "product-missing", "product-not-returned"], snapshots: [
    AnalyticsSnapshotFixtureSchema.parse({ organizationId, shopId, productId: "product-zero", definition, collectedAt: "2026-09-09T00:01:00.000Z", asOf: "2026-09-09T00:01:00.000Z", state: "value", value: 0 }),
    AnalyticsSnapshotFixtureSchema.parse({ organizationId, shopId, productId: "product-missing", definition, collectedAt: "2026-09-09T00:01:00.000Z", asOf: "2026-09-09T00:01:00.000Z", state: "missing" }),
  ], startedAt: "2026-09-09T00:00:00.000Z", finishedAt: "2026-09-09T00:01:00.000Z", expectedPages: 2, observedPages: 1 })
}
const evidence = { freshnessToleranceMinutes: 60, cursorEvidence: "complete" as const }

describe("PostgreSQL analytics persistence contract", () => {
  it("round-trips value zero, missing, and not-returned states", async () => {
    const executor = new FakeAnalyticsPostgresExecutor(); const repository = new PostgresAnalyticsRepository(executor)
    await repository.saveCollection({ collection: collection(), evidence }); const read = await repository.readCollection({ organizationId, shopId }, runId)
    assert.equal(read?.collection.run.status, "partial")
    assert.deepEqual(read?.collection.snapshots.map((snapshot) => snapshot.state), ["value", "missing", "not_returned"])
    assert.equal(read?.collection.snapshots[0]?.state === "value" ? read.collection.snapshots[0].value : undefined, 0)
  })
  it("keeps organization and shop scope fail closed", async () => {
    const executor = new FakeAnalyticsPostgresExecutor(); const repository = new PostgresAnalyticsRepository(executor)
    await repository.saveCollection({ collection: collection(), evidence })
    assert.equal(await repository.readCollection({ organizationId: otherOrganizationId, shopId }, runId), null)
  })
  it("rejects a snapshot belonging to a different collection run", async () => {
    const executor = new FakeAnalyticsPostgresExecutor(); const repository = new PostgresAnalyticsRepository(executor)
    const wrongRunId = AnalyticsCollectionRunIdSchema.parse("70000000-0000-4000-8000-000000000099")
    const wrongRun = { ...collection(), snapshots: collection().snapshots.map((snapshot) => ({ ...snapshot, collectionRunId: wrongRunId })) }
    await assert.rejects(() => repository.saveCollection({ collection: wrongRun, evidence }), /scope_mismatch/)
  })
  it("round-trips unsupported capability without treating it as missing", async () => {
    const unsupportedDefinition = AnalyticsMetricDefinitionFixtureSchema.parse({ ...definition, capability: "unsupported" })
    const unsupported = buildAnalyticsCollection({ runId, organizationId, shopId, definition: unsupportedDefinition, requestedProductIds: ["product-unsupported"], snapshots: [AnalyticsSnapshotFixtureSchema.parse({ organizationId, shopId, productId: "product-unsupported", definition: unsupportedDefinition, collectedAt: "2026-09-09T00:01:00.000Z", asOf: "2026-09-09T00:01:00.000Z", state: "unsupported" })], startedAt: "2026-09-09T00:00:00.000Z", finishedAt: "2026-09-09T00:01:00.000Z", expectedPages: 1, observedPages: 1 })
    const executor = new FakeAnalyticsPostgresExecutor(); const secondRepository = new PostgresAnalyticsRepository(executor)
    await secondRepository.saveCollection({ collection: unsupported, evidence })
    const read = await secondRepository.readCollection({ organizationId, shopId }, runId); assert.equal(read?.collection.snapshots[0]?.state, "unsupported")
  })
  it("preserves an empty requested collection without inventing snapshots", async () => {
    const empty = buildAnalyticsCollection({ runId, organizationId, shopId, definition, requestedProductIds: [], snapshots: [], startedAt: "2026-09-09T00:00:00.000Z", finishedAt: "2026-09-09T00:01:00.000Z", expectedPages: 0, observedPages: 0 })
    const executor = new FakeAnalyticsPostgresExecutor(); const secondRepository = new PostgresAnalyticsRepository(executor)
    await secondRepository.saveCollection({ collection: empty, evidence: { freshnessToleranceMinutes: 60, cursorEvidence: "complete" } }); assert.deepEqual((await secondRepository.readCollection({ organizationId, shopId }, runId))?.collection.snapshots, [])
  })
  it("uses one transaction and migration keeps explicit states and no secrets", () => {
    const migration = readFileSync(new URL("../../../db/migrations/0007_analytics.sql", import.meta.url), "utf8")
    assert.match(migration, /FOREIGN KEY \(organization_id, shop_id\)/); assert.match(migration, /FOREIGN KEY \(collection_run_id, organization_id, shop_id\)/); assert.match(migration, /state IN \('value', 'missing', 'unsupported', 'not_returned'\)/); assert.doesNotMatch(migration, /access_token|refresh_token|callback_code|raw_token/i)
  })
})
