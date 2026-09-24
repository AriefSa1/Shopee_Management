import { createHmac } from "node:crypto"
import { z } from "zod"
import { ShopeeShopIdSchema } from "./shopee-oauth.ts"
import {
  type ShopeeCatalogAccessResolver,
  ShopeeCatalogProviderError,
} from "./shopee-product-catalog.ts"

// Shopee Business Insights: POST /api/v2/business_insights/get_marketing_hot_listing.
// Shop-scoped signed call (sign = partner_id + path + timestamp + access_token + shop_id),
// with the query carrying the auth params and a JSON body carrying the time range.
// Returns shop-level key metrics (+ period-over-period change), a time series, and
// product-level performance, per order type (placed / paid / confirmed).

const HOT_LISTING_PATH = "/api/v2/business_insights/get_marketing_hot_listing"

export const HOT_LISTING_PERIODS = ["real_time", "yesterday", "past7days", "past30days"] as const
export type HotListingPeriod = (typeof HOT_LISTING_PERIODS)[number]

export type HotListingMetrics = {
  sales?: number
  buyers?: number
  orders?: number
  units?: number
  conversionRate?: number
  productImpression?: number
  productClicks?: number
  clickThroughRate?: number
  salesPctDiff?: number
  buyersPctDiff?: number
  ordersPctDiff?: number
  unitsPctDiff?: number
  conversionRatePctDiff?: number
  productImpressionPctDiff?: number
  productClicksPctDiff?: number
  clickThroughRatePctDiff?: number
}

export type HotListingTimePoint = {
  t?: number
  sales?: number
  orders?: number
  units?: number
  buyers?: number
  conversionRate?: number
  productImpression?: number
  productClicks?: number
  clickThroughRate?: number
}

export type HotListingProduct = {
  itemId?: number
  itemName?: string
  image?: string
  variationName?: string
  status?: number
  sales?: number
  buyers?: number
  orders?: number
  units?: number
  conversionRate?: number
  productImpression?: number
  productClicks?: number
  clickThroughRate?: number
}

export type HotListingOrderType = {
  orderType?: string
  metrics: HotListingMetrics
  timeSeries: HotListingTimePoint[]
  performance: HotListingProduct[]
}

export type HotListingResult = {
  orderTypes: HotListingOrderType[]
}

export type ShopeeMarketingInsightsRequest = {
  readonly shopId: string
  readonly period: HotListingPeriod
  readonly startTime: number
  readonly endTime: number
  readonly productIdList?: string
}

export type ShopeeMarketingInsightsReader = {
  readHotListing: (request: ShopeeMarketingInsightsRequest) => Promise<HotListingResult>
}

const num = z.number().optional()
const MetricsSchema = z
  .object({
    sales: num,
    buyers: num,
    orders: num,
    units: num,
    conversion_rate: num,
    product_impression: num,
    product_clicks: num,
    click_through_rate: num,
    sales_pct_diff: num,
    buyers_pct_diff: num,
    orders_pct_diff: num,
    units_pct_diff: num,
    conversion_rate_pct_diff: num,
    product_impression_pct_diff: num,
    product_clicks_pct_diff: num,
    click_through_rate_pct_diff: num,
  })
  .passthrough()

const TimePointSchema = z
  .object({
    t: num,
    sales: num,
    orders: num,
    units: num,
    buyers: num,
    conversion_rate: num,
    product_impression: num,
    product_clicks: num,
    click_through_rate: num,
  })
  .passthrough()

const PerformanceSchema = z
  .object({
    item_id: num,
    item_name: z.string().optional(),
    image: z.string().optional(),
    variation_name: z.string().optional(),
    status: num,
    sales: num,
    buyers: num,
    orders: num,
    units: num,
    conversion_rate: num,
    product_impression: num,
    product_clicks: num,
    click_through_rate: num,
  })
  .passthrough()

const ResponseSchema = z
  .object({
    code: z.number().optional(),
    msg: z.string().optional(),
    error: z.string().optional(),
    message: z.string().optional(),
    result: z
      .array(
        z
          .object({
            order_type: z.string().optional(),
            key_metrics: z
              .object({
                key_metrics: MetricsSchema.optional(),
                time_series: z.array(TimePointSchema).optional(),
              })
              .passthrough()
              .optional(),
            performance: z.array(PerformanceSchema).optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough()

function mapMetrics(input: z.infer<typeof MetricsSchema> | undefined): HotListingMetrics {
  if (input === undefined) return {}
  return {
    ...(input.sales === undefined ? {} : { sales: input.sales }),
    ...(input.buyers === undefined ? {} : { buyers: input.buyers }),
    ...(input.orders === undefined ? {} : { orders: input.orders }),
    ...(input.units === undefined ? {} : { units: input.units }),
    ...(input.conversion_rate === undefined ? {} : { conversionRate: input.conversion_rate }),
    ...(input.product_impression === undefined
      ? {}
      : { productImpression: input.product_impression }),
    ...(input.product_clicks === undefined ? {} : { productClicks: input.product_clicks }),
    ...(input.click_through_rate === undefined
      ? {}
      : { clickThroughRate: input.click_through_rate }),
    ...(input.sales_pct_diff === undefined ? {} : { salesPctDiff: input.sales_pct_diff }),
    ...(input.buyers_pct_diff === undefined ? {} : { buyersPctDiff: input.buyers_pct_diff }),
    ...(input.orders_pct_diff === undefined ? {} : { ordersPctDiff: input.orders_pct_diff }),
    ...(input.units_pct_diff === undefined ? {} : { unitsPctDiff: input.units_pct_diff }),
    ...(input.conversion_rate_pct_diff === undefined
      ? {}
      : { conversionRatePctDiff: input.conversion_rate_pct_diff }),
    ...(input.product_impression_pct_diff === undefined
      ? {}
      : { productImpressionPctDiff: input.product_impression_pct_diff }),
    ...(input.product_clicks_pct_diff === undefined
      ? {}
      : { productClicksPctDiff: input.product_clicks_pct_diff }),
    ...(input.click_through_rate_pct_diff === undefined
      ? {}
      : { clickThroughRatePctDiff: input.click_through_rate_pct_diff }),
  }
}

function mapTimePoint(input: z.infer<typeof TimePointSchema>): HotListingTimePoint {
  return {
    ...(input.t === undefined ? {} : { t: input.t }),
    ...(input.sales === undefined ? {} : { sales: input.sales }),
    ...(input.orders === undefined ? {} : { orders: input.orders }),
    ...(input.units === undefined ? {} : { units: input.units }),
    ...(input.buyers === undefined ? {} : { buyers: input.buyers }),
    ...(input.conversion_rate === undefined ? {} : { conversionRate: input.conversion_rate }),
    ...(input.product_impression === undefined
      ? {}
      : { productImpression: input.product_impression }),
    ...(input.product_clicks === undefined ? {} : { productClicks: input.product_clicks }),
    ...(input.click_through_rate === undefined
      ? {}
      : { clickThroughRate: input.click_through_rate }),
  }
}

function mapProduct(input: z.infer<typeof PerformanceSchema>): HotListingProduct {
  return {
    ...(input.item_id === undefined ? {} : { itemId: input.item_id }),
    ...(input.item_name === undefined ? {} : { itemName: input.item_name }),
    ...(input.image === undefined ? {} : { image: input.image }),
    ...(input.variation_name === undefined ? {} : { variationName: input.variation_name }),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.sales === undefined ? {} : { sales: input.sales }),
    ...(input.buyers === undefined ? {} : { buyers: input.buyers }),
    ...(input.orders === undefined ? {} : { orders: input.orders }),
    ...(input.units === undefined ? {} : { units: input.units }),
    ...(input.conversion_rate === undefined ? {} : { conversionRate: input.conversion_rate }),
    ...(input.product_impression === undefined
      ? {}
      : { productImpression: input.product_impression }),
    ...(input.product_clicks === undefined ? {} : { productClicks: input.product_clicks }),
    ...(input.click_through_rate === undefined
      ? {}
      : { clickThroughRate: input.click_through_rate }),
  }
}

export function parseHotListingResponse(input: unknown): HotListingResult {
  const parsed = ResponseSchema.safeParse(input)
  if (!parsed.success) throw new ShopeeCatalogProviderError("insights_malformed_response")
  const data = parsed.data
  if (data.error !== undefined && data.error.length > 0) {
    throw new ShopeeCatalogProviderError(safeCode(data.error))
  }
  if (data.code !== undefined && data.code !== 0) {
    throw new ShopeeCatalogProviderError(safeCode(data.msg ?? `insights_code_${data.code}`))
  }
  const orderTypes = (data.result ?? []).map((entry) => ({
    ...(entry.order_type === undefined ? {} : { orderType: entry.order_type }),
    metrics: mapMetrics(entry.key_metrics?.key_metrics),
    timeSeries: (entry.key_metrics?.time_series ?? []).map(mapTimePoint),
    performance: (entry.performance ?? []).map(mapProduct),
  }))
  return { orderTypes }
}

function safeCode(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9_:-]+/g, "_")
    .slice(0, 128)
  return cleaned.length > 0 ? cleaned : "insights_provider_error"
}

export function createShopeeMarketingInsightsReader(input: {
  readonly baseUrl: string
  readonly partnerId: string
  readonly partnerKey: string
  readonly resolveAccess: ShopeeCatalogAccessResolver
  readonly fetchImpl?: typeof fetch
}): ShopeeMarketingInsightsReader {
  const fetchImpl = input.fetchImpl ?? fetch
  return {
    async readHotListing(request: ShopeeMarketingInsightsRequest): Promise<HotListingResult> {
      const access = await input.resolveAccess(request.shopId)
      const externalShopId = ShopeeShopIdSchema.parse(access.shop.externalShopId)
      const timestamp = Math.floor(Date.now() / 1000)
      const sign = createHmac("sha256", input.partnerKey)
        .update(
          `${input.partnerId}${HOT_LISTING_PATH}${timestamp}${access.accessToken}${externalShopId}`,
        )
        .digest("hex")
      const url = new URL(HOT_LISTING_PATH, input.baseUrl)
      for (const [key, value] of Object.entries({
        partner_id: input.partnerId,
        timestamp: String(timestamp),
        access_token: access.accessToken,
        shop_id: externalShopId,
        sign,
      }))
        url.searchParams.set(key, value)
      const body = JSON.stringify({
        start_time: request.startTime,
        end_time: request.endTime,
        period: request.period,
        ...(request.productIdList === undefined ? {} : { product_id_list: request.productIdList }),
      })
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body,
      })
      let json: unknown
      try {
        json = await response.json()
      } catch {
        throw new ShopeeCatalogProviderError(`http_${response.status}`)
      }
      if (!response.ok) throw new ShopeeCatalogProviderError(`http_${response.status}`)
      return parseHotListingResponse(json)
    },
  }
}
