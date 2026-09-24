import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  AnalyticsMetricDefinitionFixtureSchema,
  AnalyticsCollectionRunIdSchema,
  AnalyticsProductIdSchema,
  AnalyticsSnapshotFixtureSchema,
  OrganizationIdSchema,
  ShopIdSchema,
  type AnalyticsCollection,
} from "./index.ts"
import { createAnalyticsApiHandler, type AnalyticsApiDependencies } from "./analytics-api.ts"

const organizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
const shopId = ShopIdSchema.parse("30000000-0000-4000-8000-000000000001")
const collectionRunId = AnalyticsCollectionRunIdSchema.parse("70000000-0000-4000-8000-000000000001")
const productId = AnalyticsProductIdSchema.parse("product-zero")
const definition = AnalyticsMetricDefinitionFixtureSchema.parse({
  metricDefinitionId: "item_views",
  version: 1,
  unit: "count",
  window: "rolling_30_days",
  capability: "enabled",
})

function dependencies(collection?: AnalyticsCollection): AnalyticsApiDependencies {
  return {
    authenticate: () => ({ organizationId, accessibleShopIds: [shopId] }),
    read: async () => collection ?? null,
  }
}

const completeCollection = {
  run: {
    collectionRunId,
    organizationId,
    shopId,
    definition,
    requestedProductIds: [productId],
    startedAt: "2026-09-09T00:00:00.000Z",
    finishedAt: "2026-09-09T00:01:00.000Z",
    expectedPages: 1,
    observedPages: 1,
    status: "complete" as const,
  },
  snapshots: [
    {
      ...AnalyticsSnapshotFixtureSchema.parse({
        organizationId,
        shopId,
        productId: "product-zero",
        definition,
        collectedAt: "2026-09-09T00:01:00.000Z",
        asOf: "2026-09-09T00:01:00.000Z",
        state: "value",
        value: 0,
      }),
      collectionRunId,
    },
  ],
}

describe("analytics read API boundary", () => {
  it("rejects unauthenticated and malformed requests without reading data", async () => {
    let reads = 0
    const deps: AnalyticsApiDependencies = {
      authenticate: () => null,
      read: async () => {
        reads += 1
        return completeCollection
      },
    }

    // Given: a request without a bearer token and no trusted identity.
    const response = await createAnalyticsApiHandler(new Request("https://app.test/api/analytics"), deps)

    // When: the read boundary handles the request.
    // Then: it fails closed before any collection read.
    assert.equal(response.status, 401)
    assert.deepEqual(await response.json(), { error: { code: "authentication_required" } })
    assert.equal(reads, 0)
  })

  it("returns zero and completeness semantics for an authorized shop", async () => {
    // Given: a complete collection containing an explicit numeric zero.
    const request = new Request(
      `https://app.test/api/analytics?organizationId=${organizationId}&shopId=${shopId}&productId=product-zero&now=2026-09-09T00:05:00.000Z&maximumAgeMinutes=10`,
      { headers: { authorization: "Bearer redacted-test-token" } },
    )

    // When: the authorized read route projects the product metric.
    const response = await createAnalyticsApiHandler(request, dependencies(completeCollection))

    // Then: zero is preserved and no write/provider fields are exposed.
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      data: {
        organizationId,
        shopId,
        productId: "product-zero",
        runStatus: "complete",
        metric: { kind: "value", value: 0, unit: "count", window: "rolling_30_days" },
      },
    })
  })

  it("denies cross-organization and inaccessible-shop reads", async () => {
    // Given: an identity limited to one organization and shop.
    const deps = dependencies(completeCollection)
    const foreignOrganization = "10000000-0000-4000-8000-000000000009"
    const foreignShop = "30000000-0000-4000-8000-000000000009"

    // When: requests target either boundary outside the authenticated scope.
    const organizationResponse = await createAnalyticsApiHandler(
      new Request(`https://app.test/api/analytics?organizationId=${foreignOrganization}&shopId=${shopId}&productId=product-zero&now=2026-09-09T00:05:00.000Z&maximumAgeMinutes=10`, { headers: { authorization: "Bearer token" } }),
      deps,
    )
    const shopResponse = await createAnalyticsApiHandler(
      new Request(`https://app.test/api/analytics?organizationId=${organizationId}&shopId=${foreignShop}&productId=product-zero&now=2026-09-09T00:05:00.000Z&maximumAgeMinutes=10`, { headers: { authorization: "Bearer token" } }),
      deps,
    )

    // Then: neither request reaches the collection reader.
    assert.equal(organizationResponse.status, 403)
    assert.deepEqual(await organizationResponse.json(), { error: { code: "organization_mismatch" } })
    assert.equal(shopResponse.status, 403)
    assert.deepEqual(await shopResponse.json(), { error: { code: "shop_not_accessible" } })
  })

  it("does not fabricate a comparison for incomplete or absent values", async () => {
    // Given: an incomplete collection with a not-returned product.
    const partial = { ...completeCollection, run: { ...completeCollection.run, status: "partial" as const, expectedPages: 2 } }
    const request = new Request(
      `https://app.test/api/analytics?organizationId=${organizationId}&shopId=${shopId}&productId=product-zero&compareProductId=product-zero&now=2026-09-09T00:05:00.000Z&maximumAgeMinutes=10`,
      { headers: { authorization: "Bearer token" } },
    )

    // When: the route projects the incomplete read.
    const response = await createAnalyticsApiHandler(request, dependencies(partial))

    // Then: completeness stays visible and the metric is not presented as a valid value.
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      data: {
        organizationId,
        shopId,
        productId: "product-zero",
        runStatus: "partial",
        metric: { kind: "value", value: 0, unit: "count", window: "rolling_30_days" },
        comparison: { kind: "ineligible", reason: "collection_incomplete" },
      },
    })
  })
})
