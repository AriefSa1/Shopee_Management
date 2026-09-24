import assert from "node:assert/strict"
import test from "node:test"
import { CatalogPageSchema, ShopIdSchema } from "../../catalog/src/catalog.ts"
import { createShopeeCatalogAdapter } from "./shopee-product-catalog.ts"

test("maps Shopee item list, base info and engagement stats into the catalog contract", async () => {
  const requested: string[] = []
  let baseInfoItemIds: string | null = null
  let extraInfoItemIds: string | null = null
  const adapter = createShopeeCatalogAdapter({
    baseUrl: "https://partner.shopeemobile.com",
    partnerId: "123",
    partnerKey: "partner-key",
    resolveAccess: async () => ({
      accessToken: "access-token",
      shop: { externalShopId: "456" as never, market: "ID" },
    }),
    fetchImpl: async (input) => {
      const requestUrl = new URL(input.toString())
      const path = requestUrl.pathname
      requested.push(path)
      if (path === "/api/v2/product/get_item_list")
        return json({ response: { item_list: [{ item_id: 99 }], has_next_page: false } })
      if (path === "/api/v2/product/get_item_base_info") {
        baseInfoItemIds = requestUrl.searchParams.get("item_id_list")
        return json({
          response: {
            item_list: [
              {
                item_id: 99,
                item_name: "Produk live",
                item_status: "NORMAL",
                stock: 7,
                models: [{ model_id: 1, model_name: "Merah", stock: 3 }],
              },
            ],
          },
        })
      }
      if (path === "/api/v2/product/get_item_extra_info") {
        extraInfoItemIds = requestUrl.searchParams.get("item_id_list")
        return json({ response: { item_list: [{ item_id: 99, sale: 12, rating_star: 4.8 }] } })
      }
      return json({ error: "unexpected" })
    },
  })
  const page = CatalogPageSchema.parse(
    await adapter.fetchPage({ shopId: ShopIdSchema.parse("00000000-0000-4000-8000-000000000001") }),
  )
  assert.deepEqual(requested, [
    "/api/v2/product/get_item_list",
    "/api/v2/product/get_item_base_info",
    "/api/v2/product/get_item_extra_info",
  ])
  assert.equal(baseInfoItemIds, "99")
  assert.equal(extraInfoItemIds, "99")
  assert.equal(page.products[0]?.name, "Produk live")
  assert.equal(page.products[0]?.availableStock, 7)
  const raw = page.products[0]?.raw as { item_name?: string; item_status?: string } | undefined
  assert.equal(raw?.item_name, "Produk live")
  assert.equal(raw?.item_status, "NORMAL")
  const stats = page.products[0]?.stats as { sale?: number; rating_star?: number } | undefined
  assert.equal(stats?.sale, 12)
  assert.equal(stats?.rating_star, 4.8)
})

test("still returns products when the engagement stats call fails", async () => {
  const adapter = createShopeeCatalogAdapter({
    baseUrl: "https://partner.shopeemobile.com",
    partnerId: "123",
    partnerKey: "partner-key",
    resolveAccess: async () => ({
      accessToken: "access-token",
      shop: { externalShopId: "456" as never, market: "ID" },
    }),
    fetchImpl: async (input) => {
      const path = new URL(input.toString()).pathname
      if (path === "/api/v2/product/get_item_list")
        return json({ response: { item_list: [{ item_id: 99 }], has_next_page: false } })
      if (path === "/api/v2/product/get_item_base_info")
        return json({
          response: {
            item_list: [{ item_id: 99, item_name: "Produk live", item_status: "NORMAL" }],
          },
        })
      return new Response("boom", { status: 500 })
    },
  })
  const page = CatalogPageSchema.parse(
    await adapter.fetchPage({ shopId: ShopIdSchema.parse("00000000-0000-4000-8000-000000000001") }),
  )
  assert.equal(page.products[0]?.name, "Produk live")
  assert.equal(page.products[0]?.stats, undefined)
})

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}
