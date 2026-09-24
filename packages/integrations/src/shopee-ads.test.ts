import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import { test } from "node:test"
import {
  createShopeeAdsReader,
  parseAdsDailyResponse,
  ShopeeAdsProviderError,
} from "./shopee-ads.ts"
import { ShopeeShopIdSchema } from "./shopee-oauth.ts"

test("parses the official CPC daily response array and preserves incomplete-data warning", () => {
  assert.deepEqual(
    parseAdsDailyResponse({ response: [{ date: "23-09-2026", expense: 0 }], warning: "partial" }),
    {
      daily: [{ date: "23-09-2026", expense: 0 }],
      partial: true,
    },
  )
  assert.throws(
    () => parseAdsDailyResponse({ error: "ads.permission.denied" }),
    (error) => error instanceof ShopeeAdsProviderError && error.code === "ads_permission_denied",
  )
  assert.throws(
    () => parseAdsDailyResponse({ data: [{ date: "23-09-2026" }] }),
    (error) => error instanceof ShopeeAdsProviderError && error.code === "ads_malformed_response",
  )
})

test("sends a signed shop-scoped GET without exposing credentials in the result", async () => {
  let requestedUrl: URL | undefined
  let requestedMethod: string | undefined
  const reader = createShopeeAdsReader({
    baseUrl: "https://partner.shopeemobile.com",
    partnerId: "123",
    partnerKey: "test-partner-key",
    resolveAccess: async () => ({
      accessToken: "test-access-token",
      shop: { externalShopId: ShopeeShopIdSchema.parse("456"), market: "ID" },
    }),
    fetchImpl: async (input, init) => {
      requestedUrl = new URL(String(input))
      requestedMethod = init?.method
      return Response.json({ response: [{ date: "23-09-2026", expense: 10 }] })
    },
  })

  const result = await reader.readDaily({
    shopId: "internal-shop-id",
    startDate: "17-09-2026",
    endDate: "23-09-2026",
  })

  assert.equal(requestedMethod, "GET")
  assert.equal(requestedUrl?.pathname, "/api/v2/ads/get_all_cpc_ads_daily_performance")
  assert.equal(requestedUrl?.searchParams.get("start_date"), "17-09-2026")
  assert.equal(requestedUrl?.searchParams.get("end_date"), "23-09-2026")
  assert.equal(requestedUrl?.searchParams.get("shop_id"), "456")
  const timestamp = requestedUrl?.searchParams.get("timestamp")
  assert.ok(timestamp)
  assert.equal(
    requestedUrl?.searchParams.get("sign"),
    createHmac("sha256", "test-partner-key")
      .update(`123/api/v2/ads/get_all_cpc_ads_daily_performance${timestamp}test-access-token456`)
      .digest("hex"),
  )
  assert.deepEqual(result, { daily: [{ date: "23-09-2026", expense: 10 }], partial: false })
})

test("preserves a safe provider error code from a non-success response", async () => {
  const reader = createShopeeAdsReader({
    baseUrl: "https://partner.shopeemobile.com",
    partnerId: "123",
    partnerKey: "test-partner-key",
    resolveAccess: async () => ({
      accessToken: "test-access-token",
      shop: { externalShopId: ShopeeShopIdSchema.parse("456"), market: "ID" },
    }),
    fetchImpl: async () => Response.json({ error: "ads.permission.denied" }, { status: 403 }),
  })

  await assert.rejects(
    reader.readDaily({
      shopId: "internal-shop-id",
      startDate: "17-09-2026",
      endDate: "23-09-2026",
    }),
    (error) => error instanceof ShopeeAdsProviderError && error.code === "ads_permission_denied",
  )
})
