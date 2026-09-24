import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { CatalogCapabilitySchema, CatalogProductFixtureSchema, OrganizationIdSchema, ShopIdSchema } from "./catalog.ts"
import { createCatalogApiHandler, type CatalogApiDependencies } from "./catalog-api.ts"

const organizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
const shopId = ShopIdSchema.parse("30000000-0000-4000-8000-000000000001")

function dependencies(overrides: Partial<CatalogApiDependencies> = {}): CatalogApiDependencies {
  const product = CatalogProductFixtureSchema.parse({
    productId: "prod-a",
    name: "Alpha",
    publication: "active",
    availableStock: 0,
    variants: [],
  })
  return {
    authenticate: () => ({
      organizationId,
      accessibleShopIds: [shopId],
      capability: CatalogCapabilitySchema.parse("enabled"),
    }),
    adapter: {
      capability: CatalogCapabilitySchema.parse("enabled"),
      async fetchPage() {
        return { products: [product], hasNextPage: false }
      },
    },
    collectedAt: "2026-09-09T00:00:00.000Z",
    ...overrides,
  }
}

describe("catalog HTTP read boundary", () => {
  it("rejects unauthenticated requests before the provider is invoked", async () => {
    // Given: a request without an authenticated read context.
    let providerCalls = 0
    const response = await createCatalogApiHandler(
      new Request(`http://localhost/api/catalog?organizationId=${organizationId}&shopId=${shopId}`),
      dependencies({
        authenticate: () => null,
        adapter: {
          capability: CatalogCapabilitySchema.parse("enabled"),
          async fetchPage() {
            providerCalls += 1
            return { products: [], hasNextPage: false }
          },
        },
      }),
    )

    // Then: no upstream interaction occurs and the response is safe.
    assert.equal(response.status, 401)
    assert.deepEqual(await response.json(), { error: { code: "authentication_required" } })
    assert.equal(providerCalls, 0)
  })

  it("returns scoped catalog data with explicit completeness and zero-stock semantics", async () => {
    // Given: an authenticated organization/shop scope and a complete fixture page.
    const response = await createCatalogApiHandler(
      new Request(`http://localhost/api/catalog?organizationId=${organizationId}&shopId=${shopId}&stock=out_of_stock`, { headers: { authorization: "Bearer fixture-token" } }),
      dependencies(),
    )

    // Then: the read response contains only contract fields and preserves numeric zero.
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      data: {
        organizationId,
        shopId,
        collectedAt: "2026-09-09T00:00:00.000Z",
        completeness: { kind: "complete" },
        products: [
          { productId: "prod-a", name: "Alpha", publication: "active", availableStock: 0, variants: [] },
        ],
      },
    })
  })

  it("fails closed for foreign shops and malformed query parameters", async () => {
    // Given: an authenticated scope that does not own the requested shop.
    const foreignShop = ShopIdSchema.parse("30000000-0000-4000-8000-000000000002")
    const denied = await createCatalogApiHandler(
      new Request(`http://localhost/api/catalog?organizationId=${organizationId}&shopId=${foreignShop}`, { headers: { authorization: "Bearer fixture-token" } }),
      dependencies(),
    )
    const malformed = await createCatalogApiHandler(
      new Request(`http://localhost/api/catalog?organizationId=bad&shopId=${shopId}`, { headers: { authorization: "Bearer fixture-token" } }),
      dependencies(),
    )

    // Then: neither request reaches the provider and error codes reveal no upstream details.
    assert.equal(denied.status, 403)
    assert.deepEqual(await denied.json(), { error: { code: "shop_not_accessible" } })
    assert.equal(malformed.status, 400)
    assert.deepEqual(await malformed.json(), { error: { code: "invalid_catalog_request" } })
  })
})
