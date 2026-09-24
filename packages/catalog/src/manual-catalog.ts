import {
  CatalogCapabilitySchema,
  CatalogProductFixtureSchema,
  OrganizationIdSchema,
  ShopIdSchema,
  collectCatalogPages,
  filterCatalog,
} from "./catalog.ts"

class CatalogManualQaError extends Error {
  readonly name = "CatalogManualQaError"
  readonly reason: "unexpected_page_request" | "catalog_collection_failed"

  constructor(reason: "unexpected_page_request" | "catalog_collection_failed") {
    super("Catalog manual QA fixture failed")
    this.reason = reason
  }
}

const organizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
const shopId = ShopIdSchema.parse("30000000-0000-4000-8000-000000000001")
const pages = [
  {
    products: [
      CatalogProductFixtureSchema.parse({
        productId: "manual-zero",
        name: "Manual Zero",
        publication: "active",
        availableStock: 0,
        variants: [],
      }),
      CatalogProductFixtureSchema.parse({
        productId: "manual-not-returned",
        name: "Manual Not Returned",
        publication: "active",
        variants: [],
      }),
    ],
    hasNextPage: false,
  },
]

let pageIndex = 0
const result = await collectCatalogPages({
  context: {
    organizationId,
    accessibleShopIds: [shopId],
    capability: CatalogCapabilitySchema.parse("enabled"),
  },
  shopId,
  adapter: {
    capability: CatalogCapabilitySchema.parse("enabled"),
    async fetchPage() {
      const page = pages[pageIndex]
      pageIndex += 1
      if (page === undefined) throw new CatalogManualQaError("unexpected_page_request")
      return page
    },
  },
  collectedAt: "2026-09-09T00:00:00.000Z",
})

if (result.kind !== "collected") throw new CatalogManualQaError("catalog_collection_failed")

console.log(
  JSON.stringify({
    scenario: "catalog-provider-fixture",
    completeness: result.collection.completeness.kind,
    outOfStockProductIds: filterCatalog(result.collection, { stock: "out_of_stock" }).map(
      (product) => product.productId,
    ),
    notReturnedProductIds: filterCatalog(result.collection, { stock: "not_returned" }).map(
      (product) => product.productId,
    ),
    networkCalls: 0,
    shopeeMutations: 0,
    secretFieldsPresent: false,
  }),
)
