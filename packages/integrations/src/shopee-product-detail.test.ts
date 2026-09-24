import assert from "node:assert/strict"
import test from "node:test"
import { createShopeeProductDetailReader } from "./shopee-product-detail.ts"

test("reads all product detail sections and returns their raw bodies", async () => {
  const reader = createShopeeProductDetailReader({
    baseUrl: "https://partner.shopeemobile.com",
    partnerId: "123",
    partnerKey: "partner-key",
    resolveAccess: async () => ({
      accessToken: "access",
      shop: { externalShopId: "456" as never, market: "ID" },
    }),
    fetchImpl: async (input) => {
      const path = new URL(input.toString()).pathname
      const bodies: Record<string, unknown> = {
        "/api/v2/product/get_item_base_info": {
          error: "",
          response: { item_list: [{ item_id: 99, item_name: "P" }] },
        },
        "/api/v2/product/get_model_list": {
          error: "",
          response: { model: [{ model_id: 1, price_info: [{ current_price: 1000 }] }] },
        },
        "/api/v2/product/get_item_extra_info": {
          error: "",
          response: { item_list: [{ item_id: 99, sale: 5 }] },
        },
        "/api/v2/product/get_item_promotion": {
          error: "",
          response: { success_list: [{ item_id: 99, promotion: [] }] },
        },
      }
      return new Response(JSON.stringify(bodies[path] ?? { error: "unexpected" }), { status: 200 })
    },
  })
  const detail = await reader.readItemDetail({
    shopId: "00000000-0000-4000-8000-000000000001",
    itemId: 99,
  })
  assert.equal(detail.itemId, 99)
  assert.deepEqual((detail.raw.base_info as any).response.item_list[0].item_name, "P")
  assert.deepEqual(
    (detail.raw.model_list as any).response.model[0].price_info[0].current_price,
    1000,
  )
  assert.deepEqual((detail.raw.extra_info as any).response.item_list[0].sale, 5)
  assert.ok("promotion" in detail.raw)
})

test("captures a failing section without aborting the others", async () => {
  let calls = 0
  const reader = createShopeeProductDetailReader({
    baseUrl: "https://partner.shopeemobile.com",
    partnerId: "123",
    partnerKey: "partner-key",
    resolveAccess: async () => ({
      accessToken: "access",
      shop: { externalShopId: "456" as never, market: "ID" },
    }),
    fetchImpl: async (input) => {
      calls += 1
      const path = new URL(input.toString()).pathname
      if (path === "/api/v2/product/get_model_list")
        return new Response("not-json", { status: 500 })
      return new Response(JSON.stringify({ error: "", response: { ok: true } }), { status: 200 })
    },
  })
  const detail = await reader.readItemDetail({
    shopId: "00000000-0000-4000-8000-000000000001",
    itemId: 99,
  })
  assert.equal(calls, 4)
  assert.deepEqual((detail.raw.model_list as any).error, "http_500")
  assert.deepEqual((detail.raw.base_info as any).response.ok, true)
})

test("rejects a non-positive item id before calling the provider", async () => {
  let calls = 0
  const reader = createShopeeProductDetailReader({
    baseUrl: "https://partner.shopeemobile.com",
    partnerId: "123",
    partnerKey: "partner-key",
    resolveAccess: async () => {
      calls += 1
      return { accessToken: "access", shop: { externalShopId: "456" as never, market: "ID" } }
    },
    fetchImpl: async () => new Response("{}", { status: 200 }),
  })
  await assert.rejects(
    reader.readItemDetail({ shopId: "00000000-0000-4000-8000-000000000001", itemId: 0 }),
  )
  assert.equal(calls, 0)
})
