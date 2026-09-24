import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { OrganizationIdSchema, ShopIdSchema } from "../../identity/src/model.ts"
import { CatalogCollectionRunIdSchema, PostgresCatalogRepository } from "./postgres-catalog.ts"
import { CatalogProductFixtureSchema } from "./catalog.ts"
import { FakeCatalogPostgresExecutor } from "./postgres-catalog.fake.ts"

const org = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
const otherOrg = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000009")
const shop = ShopIdSchema.parse("30000000-0000-4000-8000-000000000001")
const runId = CatalogCollectionRunIdSchema.parse("70000000-0000-4000-8000-000000000001")
const collection = { organizationId: org, shopId: shop, collectedAt: "2026-09-09T01:00:00.000Z", completeness: { kind: "complete" as const }, products: [CatalogProductFixtureSchema.parse({ productId: "p-1", name: "Product", publication: "active", availableStock: 0, variants: [{ variantId: "v-1", name: "Variant" }] })] }

describe("PostgreSQL catalog persistence contract", () => {
  it("round-trips products, variants, and numeric zero versus missing stock", async () => {
    const executor = new FakeCatalogPostgresExecutor(); const repo = new PostgresCatalogRepository(executor)
    await repo.saveCollection({ collectionRunId: runId, collection }); const read = await repo.readCollection({ organizationId: org, shopId: shop }, runId)
    assert.deepEqual(read?.products[0]?.availableStock, 0); assert.equal(read?.products[0]?.variants[0]?.availableStock, undefined)
  })
  it("keeps organization and shop scope fail closed", async () => {
    const executor = new FakeCatalogPostgresExecutor(); const repo = new PostgresCatalogRepository(executor)
    await repo.saveCollection({ collectionRunId: runId, collection }); assert.equal(await repo.readCollection({ organizationId: otherOrg, shopId: shop }, runId), null)
  })
  it("preserves incomplete collection evidence without deletion inference", async () => {
    const executor = new FakeCatalogPostgresExecutor(); const repo = new PostgresCatalogRepository(executor)
    await repo.saveCollection({ collectionRunId: runId, collection: { ...collection, completeness: { kind: "incomplete", reason: "missing_next_cursor" } } })
    assert.equal((await repo.readCollection({ organizationId: org, shopId: shop }, runId))?.completeness.kind, "incomplete")
  })
  it("round-trips an empty collection without inventing a product", async () => {
    const executor = new FakeCatalogPostgresExecutor(); const repo = new PostgresCatalogRepository(executor)
    await repo.saveCollection({ collectionRunId: runId, collection: { ...collection, products: [] } })
    const read = await repo.readCollection({ organizationId: org, shopId: shop }, runId)
    assert.deepEqual(read?.products, [])
  })
  it("uses one transaction and shop-scoped SQL", async () => {
    const executor = new FakeCatalogPostgresExecutor(); const repo = new PostgresCatalogRepository(executor); await repo.saveCollection({ collectionRunId: runId, collection })
    assert.equal(executor.statements.filter((s) => s.name === "catalog.collection_run.insert").length, 1); assert.match(executor.statements.find((s) => s.name === "catalog.product.insert")?.text ?? "", /organization_id, shop_id/)
  })
  it("keeps migration composite scope and nullable stock explicit", () => {
    const migration = readFileSync(new URL("../../../db/migrations/0006_catalog.sql", import.meta.url), "utf8")
    assert.match(migration, /FOREIGN KEY \(organization_id, shop_id\)/); assert.match(migration, /FOREIGN KEY \(collection_run_id, organization_id, shop_id\)/); assert.match(migration, /available_stock integer CHECK \(available_stock IS NULL OR available_stock >= 0\)/); assert.doesNotMatch(migration, /access_token|refresh_token|callback_code|raw_token/i)
  })
})
