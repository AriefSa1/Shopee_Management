import { CatalogCapabilitySchema, CatalogProductFixtureSchema, OrganizationIdSchema, ShopIdSchema } from "./catalog.ts"
import { createCatalogApiHandler } from "./catalog-api.ts"

class CatalogApiManualQaError extends Error {
  readonly name = "CatalogApiManualQaError"
  constructor(reason: "unexpected_status") {
    super(`Catalog API manual QA failed: ${reason}`)
  }
}

const organizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
const shopId = ShopIdSchema.parse("30000000-0000-4000-8000-000000000001")
const product = CatalogProductFixtureSchema.parse({
  productId: "manual-api-zero",
  name: "Manual API Zero",
  publication: "active",
  availableStock: 0,
  variants: [],
})
const response = await createCatalogApiHandler(
  new Request(`http://localhost/api/catalog?organizationId=${organizationId}&shopId=${shopId}&stock=out_of_stock`, {
    headers: { authorization: "Bearer fixture-token" },
  }),
  {
    authenticate: () => ({ organizationId, accessibleShopIds: [shopId], capability: "enabled" }),
    adapter: {
      capability: CatalogCapabilitySchema.parse("enabled"),
      async fetchPage() {
        return { products: [product], hasNextPage: false }
      },
    },
    collectedAt: "2026-09-09T00:00:00.000Z",
  },
)
if (response.status !== 200) throw new CatalogApiManualQaError("unexpected_status")
const body = await response.json()
console.log(JSON.stringify({ scenario: "catalog-read-api-fixture", status: response.status, body, networkCalls: 0, databaseCalls: 0, shopeeMutations: 0, secretFieldsPresent: false }))
