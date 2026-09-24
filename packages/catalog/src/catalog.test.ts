import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  CatalogCapabilitySchema,
  CatalogCursorSchema,
  CatalogProductFixtureSchema,
  OrganizationIdSchema,
  ShopIdSchema,
  collectCatalogPages,
  filterCatalog,
  requestCatalogSync,
  toSafeCatalogError,
} from "./catalog.ts"

const organizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
const otherOrganizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000002")
const shopId = ShopIdSchema.parse("30000000-0000-4000-8000-000000000001")
const otherShopId = ShopIdSchema.parse("30000000-0000-4000-8000-000000000002")
const collectedAt = "2026-09-09T00:00:00.000Z"

function product(input: { readonly id: string; readonly name: string; readonly stock?: number }) {
  return CatalogProductFixtureSchema.parse({
    productId: input.id,
    name: input.name,
    publication: "active",
    ...(input.stock === undefined ? {} : { availableStock: input.stock }),
    variants: [],
  })
}

function readContext(input?: { readonly shopIds?: readonly string[]; readonly capability?: "enabled" | "unsupported" }) {
  return {
    organizationId,
    accessibleShopIds: (input?.shopIds ?? [shopId]).map((value) => ShopIdSchema.parse(value)),
    capability: CatalogCapabilitySchema.parse(input?.capability ?? "enabled"),
  }
}

describe("catalog collection contracts", () => {
  it("rejects malformed cursors before an adapter is called", async () => {
    // Given: a catalog read with an invalid external cursor value.
    const requests: string[] = []
    const adapter = {
      capability: CatalogCapabilitySchema.parse("enabled"),
      async fetchPage() {
        requests.push("called")
        return { products: [], hasNextPage: false }
      },
    }

    // When: the sync boundary receives the malformed cursor.
    const result = await collectCatalogPages({
      context: readContext(),
      shopId,
      adapter,
      collectedAt,
      initialCursor: " ",
    })

    // Then: it fails before the capability-gated adapter sees a request.
    assert.deepEqual(result, { kind: "denied", reason: "malformed_cursor" })
    assert.deepEqual(requests, [])
  })

  it("marks duplicate product pages incomplete while preserving deterministic projection order", async () => {
    // Given: two fixture pages where the second repeats an upstream product and each page is unordered.
    const pages = [
      {
        products: [product({ id: "prod-b", name: "B", stock: 0 }), product({ id: "prod-a", name: "A" })],
        hasNextPage: true,
        nextCursor: CatalogCursorSchema.parse("cursor-two"),
      },
      {
        products: [product({ id: "prod-c", name: "C" }), product({ id: "prod-a", name: "A duplicate" })],
        hasNextPage: false,
      },
    ]
    let pageIndex = 0
    const adapter = {
      capability: CatalogCapabilitySchema.parse("enabled"),
      async fetchPage() {
        const page = pages[pageIndex]
        pageIndex += 1
        if (page === undefined) throw new CatalogFixtureError("unexpected_page_request")
        return page
      },
    }

    // When: collection follows the fixture cursor chain.
    const result = await collectCatalogPages({ context: readContext(), shopId, adapter, collectedAt })

    // Then: it does not claim completeness and retains a stable product ordering for safe display.
    assert.equal(result.kind, "collected")
    if (result.kind !== "collected") return
    assert.deepEqual(result.collection.completeness, { kind: "incomplete", reason: "duplicate_product" })
    assert.deepEqual(
      result.collection.products.map((entry) => entry.productId),
      ["prod-a", "prod-b", "prod-c"],
    )
  })

  it("marks a page chain incomplete when an upstream next cursor is missing", async () => {
    // Given: an upstream page that announces more products but omits the continuation cursor.
    const adapter = {
      capability: CatalogCapabilitySchema.parse("enabled"),
      async fetchPage() {
        return { products: [product({ id: "prod-a", name: "A" })], hasNextPage: true }
      },
    }

    // When: the collector reaches that pagination boundary.
    const result = await collectCatalogPages({ context: readContext(), shopId, adapter, collectedAt })

    // Then: the result stays readable but explicitly incomplete instead of treating absent data as deletion.
    assert.equal(result.kind, "collected")
    if (result.kind !== "collected") return
    assert.deepEqual(result.collection.completeness, { kind: "incomplete", reason: "missing_next_cursor" })
  })

  it("preserves zero stock separately from a field not returned by the provider", async () => {
    // Given: one product with a real zero and another whose stock field was not returned.
    const adapter = {
      capability: CatalogCapabilitySchema.parse("enabled"),
      async fetchPage() {
        return {
          products: [product({ id: "prod-zero", name: "Zero", stock: 0 }), product({ id: "prod-missing", name: "Missing" })],
          hasNextPage: false,
        }
      },
    }

    // When: the complete collection is converted to a filterable projection.
    const result = await collectCatalogPages({ context: readContext(), shopId, adapter, collectedAt })

    // Then: zero is filterable as out-of-stock while missing stays explicitly not-returned.
    assert.equal(result.kind, "collected")
    if (result.kind !== "collected") return
    const zero = filterCatalog(result.collection, { stock: "out_of_stock" })
    const missing = filterCatalog(result.collection, { stock: "not_returned" })
    assert.deepEqual(zero.map((entry) => entry.productId), ["prod-zero"])
    assert.deepEqual(missing.map((entry) => entry.productId), ["prod-missing"])
  })

  it("reports stale freshness from the supplied clock without rewriting collection completeness", async () => {
    // Given: a completed catalog snapshot collected before the required freshness window.
    const adapter = {
      capability: CatalogCapabilitySchema.parse("enabled"),
      async fetchPage() {
        return { products: [product({ id: "prod-a", name: "A" })], hasNextPage: false }
      },
    }
    const result = await collectCatalogPages({ context: readContext(), shopId, adapter, collectedAt })
    assert.equal(result.kind, "collected")
    if (result.kind !== "collected") return

    // When: a deterministic later clock applies a ten-minute freshness window.
    const visible = filterCatalog(result.collection, {
      freshness: { now: "2026-09-09T00:11:00.000Z", maximumAgeMinutes: 10 },
    })

    // Then: the snapshot is omitted by a fresh-only filter but remains a complete historical collection.
    assert.deepEqual(visible, [])
    assert.deepEqual(result.collection.completeness, { kind: "complete" })
  })

  it("denies foreign shops and unsupported capabilities before provider invocation with safe error codes", async () => {
    // Given: a read scope for one organization/shop and an adapter that records calls.
    let invocationCount = 0
    const adapter = {
      capability: CatalogCapabilitySchema.parse("enabled"),
      async fetchPage() {
        invocationCount += 1
        return { products: [], hasNextPage: false }
      },
    }

    // When: a foreign organization requests the shop, then a valid organization lacks product-read capability.
    const foreign = requestCatalogSync({
      context: { ...readContext(), organizationId: otherOrganizationId },
      requestedOrganizationId: organizationId,
      shopId,
      adapter,
    })
    const unsupported = requestCatalogSync({
      context: readContext({ capability: "unsupported" }),
      requestedOrganizationId: organizationId,
      shopId,
      adapter,
    })

    // Then: both denials are actionable and omit upstream text, identifiers, and secret-bearing details.
    assert.deepEqual(foreign, { kind: "denied", reason: "organization_mismatch" })
    assert.deepEqual(unsupported, { kind: "denied", reason: "capability_unavailable" })
    assert.equal(invocationCount, 0)
    assert.deepEqual(toSafeCatalogError({ kind: "adapter_failure", upstreamDetail: "Bearer fixture-secret" }), {
      code: "catalog_provider_unavailable",
      retryable: true,
    })
  })

  it("does not authorize an inaccessible shop even when the adapter declares support", () => {
    // Given: a capable adapter and a scope that owns only shop A.
    const adapter = {
      capability: CatalogCapabilitySchema.parse("enabled"),
      async fetchPage() {
        return { products: [], hasNextPage: false }
      },
    }

    // When: the scope attempts to select another shop.
    const decision = requestCatalogSync({
      context: readContext(),
      requestedOrganizationId: organizationId,
      shopId: otherShopId,
      adapter,
    })

    // Then: the request is denied before any external interaction can occur.
    assert.deepEqual(decision, { kind: "denied", reason: "shop_not_accessible" })
  })
})

class CatalogFixtureError extends Error {
  readonly name = "CatalogFixtureError"
  readonly reason: "unexpected_page_request"

  constructor(reason: "unexpected_page_request") {
    super("Catalog fixture requested an unexpected page")
    this.reason = reason
  }
}
