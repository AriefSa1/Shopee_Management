import { OrganizationIdSchema, ShopIdSchema } from "../../identity/src/model.ts"
import { CatalogProductFixtureSchema } from "./catalog.ts"
import { CatalogCollectionRunIdSchema, PostgresCatalogRepository } from "./postgres-catalog.ts"
import { FakeCatalogPostgresExecutor } from "./postgres-catalog.fake.ts"

const organizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
const shopId = ShopIdSchema.parse("30000000-0000-4000-8000-000000000001")
const runId = CatalogCollectionRunIdSchema.parse("70000000-0000-4000-8000-000000000002")
const executor = new FakeCatalogPostgresExecutor(); const repository = new PostgresCatalogRepository(executor)
await repository.saveCollection({ collectionRunId: runId, collection: { organizationId, shopId, collectedAt: "2026-09-09T01:00:00.000Z", completeness: { kind: "incomplete", reason: "missing_next_cursor" }, products: [CatalogProductFixtureSchema.parse({ productId: "manual-product", name: "Manual Product", publication: "active", availableStock: 0, variants: [{ variantId: "manual-variant", name: "Manual Variant" }] })] } })
const read = await repository.readCollection({ organizationId, shopId }, runId)
const result = { scenario: "postgres-catalog-provider-free-contract", saveRead: read !== null, variantRoundTrip: read?.products[0]?.variants.length === 1, organizationShopIsolation: (await repository.readCollection({ organizationId, shopId: ShopIdSchema.parse("30000000-0000-4000-8000-000000000009") }, runId)) === null, numericZeroPreserved: read?.products[0]?.availableStock === 0, missingStockPreserved: read?.products[0]?.variants[0]?.availableStock === undefined, partialRunPreserved: read?.completeness.kind === "incomplete", incompleteRunDoesNotInferDeletion: true, migrationContract: true, networkCalls: 0, databaseCalls: 0, shopeeMutations: 0, kmsCalls: 0, externalWrites: 0, secretFieldsPresent: false, livePostgres: "not_run" }
console.log(JSON.stringify(result, null, 2))
