import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { createCopyPreviewApiHandler, type CopyPreviewApiDependencies } from "./copy-preview-api.ts"
import { OrganizationIdSchema, ShopIdSchema } from "./model.ts"

const organizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
const sourceShopId = ShopIdSchema.parse("30000000-0000-4000-8000-000000000001")
const destinationShopId = ShopIdSchema.parse("30000000-0000-4000-8000-000000000002")

describe("copy preview API boundary", () => {
  it("requires a bearer-authenticated organization before reading a preview request", async () => {
    const request = new Request("http://localhost/api/copy-preview", {
      method: "POST",
      body: JSON.stringify(validInput()),
      headers: { "content-type": "application/json" },
    })

    const response = await createCopyPreviewApiHandler(request, dependencies())

    assert.equal(response.status, 401)
    assert.deepEqual(await response.json(), { error: { code: "authentication_required" } })
  })

  it("returns one deterministic preview per authorized destination without mutation", async () => {
    const request = new Request("http://localhost/api/copy-preview", {
      method: "POST",
      body: JSON.stringify(validInput()),
      headers: { "content-type": "application/json", authorization: "Bearer fixture-token" },
    })

    const response = await createCopyPreviewApiHandler(request, dependencies())
    const body = await response.json()

    assert.equal(response.status, 200)
    assert.equal(body.data.organizationId, organizationId)
    assert.equal(body.data.previews.length, 1)
    assert.equal(body.data.previews[0].destinationShopId, destinationShopId)
    assert.equal(body.data.previews[0].preview.kind, "valid")
    assert.equal(body.data.previews[0].preview.mutationBoundary.preConfirmationShopeeMutationTotal, 0)
    assert.equal(body.data.adapter.mode, "read_only")
    assert.equal(body.data.adapter.preConfirmationShopeeMutationTotal, 0)
  })

  it("denies a destination outside the authenticated organization scope", async () => {
    const request = new Request("http://localhost/api/copy-preview", {
      method: "POST",
      body: JSON.stringify(validInput()),
      headers: { "content-type": "application/json", authorization: "Bearer fixture-token" },
    })

    const response = await createCopyPreviewApiHandler(request, dependencies({ accessibleShopIds: [sourceShopId] }))

    assert.equal(response.status, 403)
    assert.deepEqual(await response.json(), { error: { code: "shop_not_accessible", shopId: destinationShopId } })
  })

  it("denies a caller source that does not match the canonical snapshot", async () => {
    const input = validInput()
    input.source.title = "caller-edited-title"
    const request = new Request("http://localhost/api/copy-preview", {
      method: "POST",
      body: JSON.stringify(input),
      headers: { "content-type": "application/json", authorization: "Bearer fixture-token" },
    })

    const response = await createCopyPreviewApiHandler(request, dependencies())

    assert.equal(response.status, 403)
    assert.deepEqual(await response.json(), { error: { code: "source_snapshot_mismatch" } })
  })

  it("rejects malformed input at the boundary", async () => {
    const request = new Request("http://localhost/api/copy-preview", {
      method: "POST",
      body: JSON.stringify({ source: { organizationId }, destinations: [] }),
      headers: { "content-type": "application/json", authorization: "Bearer fixture-token" },
    })

    const response = await createCopyPreviewApiHandler(request, dependencies())

    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), { error: { code: "invalid_copy_preview_request" } })
  })
})

function dependencies(overrides: { readonly accessibleShopIds?: readonly ReturnType<typeof ShopIdSchema.parse>[] } = {}): CopyPreviewApiDependencies {
  return {
    authenticate: () => ({ organizationId, accessibleShopIds: [sourceShopId, destinationShopId], ...overrides }),
    sourceSnapshots: { loadCanonicalSourceSnapshot: async () => validInput().source },
  }
}

function validInput() {
  return {
    source: {
      organizationId,
      sourceShopId,
      sourceProductId: "source-product-1",
      capturedAt: "2026-09-09T00:00:00.000Z",
      completeness: "complete" as const,
      title: "Product title",
      description: "Safe source description",
      categoryId: "source-category",
      attributes: { color: "blue" },
    },
    destinations: [{
      requirement: {
        organizationId,
        destinationShopId,
        capturedAt: "2026-09-09T00:01:00.000Z",
        completeness: "complete",
        allowedCategoryIds: ["target-category"],
        requiredAttributes: ["color"],
        maximumTitleLength: 120,
      },
      mapping: { destinationCategoryId: "target-category" },
    }],
  }
}
