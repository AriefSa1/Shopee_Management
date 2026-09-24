import { createHmac } from "node:crypto"
import { z } from "zod"
import { ShopeeShopIdSchema } from "./shopee-oauth.ts"
import type { ShopeeCatalogAccessResolver } from "./shopee-product-catalog.ts"

const DAILY_PERFORMANCE_PATH = "/api/v2/ads/get_all_cpc_ads_daily_performance"

const DailyRowSchema = z.object({
  date: z.string(),
  impression: z.number().optional(),
  clicks: z.number().optional(),
  ctr: z.number().optional(),
  direct_order: z.number().optional(),
  broad_order: z.number().optional(),
  direct_gmv: z.number().optional(),
  broad_gmv: z.number().optional(),
  expense: z.number().optional(),
  direct_roas: z.number().optional(),
  broad_roas: z.number().optional(),
})

const DailyResponseSchema = z.object({
  error: z.string().optional(),
  warning: z.string().optional(),
  response: z.array(DailyRowSchema).optional(),
})

export type AdsDailyRow = z.infer<typeof DailyRowSchema>

export class ShopeeAdsProviderError extends Error {
  readonly code: string

  constructor(code: string) {
    super(code)
    this.code = code
  }
}

function safeCode(value: string): string {
  const code = value
    .toLowerCase()
    .replace(/[^a-z0-9_:-]+/g, "_")
    .slice(0, 128)
  return code || "ads_provider_error"
}

export function parseAdsDailyResponse(input: unknown): { daily: AdsDailyRow[]; partial: boolean } {
  const parsed = DailyResponseSchema.safeParse(input)
  if (!parsed.success) throw new ShopeeAdsProviderError("ads_malformed_response")
  if (parsed.data.error && parsed.data.error.length > 0) {
    throw new ShopeeAdsProviderError(safeCode(parsed.data.error))
  }
  if (!parsed.data.response) throw new ShopeeAdsProviderError("ads_malformed_response")
  return { daily: parsed.data.response, partial: Boolean(parsed.data.warning) }
}

export type ShopeeAdsReader = {
  readDaily: (request: {
    readonly shopId: string
    readonly startDate: string
    readonly endDate: string
  }) => Promise<{ daily: AdsDailyRow[]; partial: boolean }>
}

export function createShopeeAdsReader(input: {
  readonly baseUrl: string
  readonly partnerId: string
  readonly partnerKey: string
  readonly resolveAccess: ShopeeCatalogAccessResolver
  readonly fetchImpl?: typeof fetch
}): ShopeeAdsReader {
  const fetchImpl = input.fetchImpl ?? fetch
  return {
    async readDaily(request) {
      const access = await input.resolveAccess(request.shopId)
      const externalShopId = ShopeeShopIdSchema.parse(access.shop.externalShopId)
      const timestamp = Math.floor(Date.now() / 1000)
      const sign = createHmac("sha256", input.partnerKey)
        .update(
          `${input.partnerId}${DAILY_PERFORMANCE_PATH}${timestamp}${access.accessToken}${externalShopId}`,
        )
        .digest("hex")
      const url = new URL(DAILY_PERFORMANCE_PATH, input.baseUrl)
      for (const [key, value] of Object.entries({
        partner_id: input.partnerId,
        timestamp: String(timestamp),
        access_token: access.accessToken,
        shop_id: externalShopId,
        sign,
        start_date: request.startDate,
        end_date: request.endDate,
      }))
        url.searchParams.set(key, value)
      const response = await fetchImpl(url, {
        method: "GET",
        headers: { accept: "application/json" },
      })
      const body: unknown = await response.json().catch(() => null)
      if (!response.ok) {
        const failure = DailyResponseSchema.safeParse(body)
        throw new ShopeeAdsProviderError(
          failure.success && failure.data.error
            ? safeCode(failure.data.error)
            : `http_${response.status}`,
        )
      }
      return parseAdsDailyResponse(body)
    },
  }
}
