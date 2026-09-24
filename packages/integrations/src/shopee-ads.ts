import { createHmac } from "node:crypto"
import { z } from "zod"
import { type ShopeeShopId, ShopeeShopIdSchema } from "./shopee-oauth.ts"
import type { ShopeeCatalogAccess, ShopeeCatalogAccessResolver } from "./shopee-product-catalog.ts"

const DAILY_PERFORMANCE_PATH = "/api/v2/ads/get_all_cpc_ads_daily_performance"
const PRODUCT_CAMPAIGN_ID_LIST_PATH = "/api/v2/ads/get_product_level_campaign_id_list"
const PRODUCT_CAMPAIGN_SETTING_PATH = "/api/v2/ads/get_product_level_campaign_setting_info"
const GMS_DELETED_ITEM_PATH = "/api/v2/ads/list_gms_user_deleted_item"
const GMS_CAMPAIGN_PERFORMANCE_PATH = "/api/v2/ads/get_gms_campaign_performance"
const GMS_ITEM_PERFORMANCE_PATH = "/api/v2/ads/get_gms_item_performance"

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

// Shared envelope check for the newer Ads endpoints: a non-empty `error` (that is
// not the "-" placeholder) is a provider failure; a non-empty `warning` means the
// data may be partial.
function assertEnvelope(error: unknown, warning: unknown): boolean {
  if (typeof error === "string" && error.length > 0 && error !== "-") {
    throw new ShopeeAdsProviderError(safeCode(error))
  }
  return typeof warning === "string" && warning.length > 0 && warning !== "-"
}

export type ProductCampaignId = { adType?: string; campaignId: number }

export type ProductCampaignSetting = {
  campaignId: number
  adType?: string
  adName?: string
  campaignStatus?: string
  biddingMethod?: string
  campaignPlacement?: string
  campaignBudget?: number
  startTime?: number
  endTime?: number
  itemIds: number[]
  roasTarget?: number
}

export type GmsReport = {
  expense?: number
  broadGmv?: number
  broadOrder?: number
  broadRoi?: number
  directOrder?: number
  directRoi?: number
  clicks?: number
  impression?: number
  cpc?: number
  cr?: number
}

export type GmsItemPerformance = { itemId?: number; report?: GmsReport }

export type ShopeeAdsReader = {
  readDaily: (request: {
    readonly shopId: string
    readonly startDate: string
    readonly endDate: string
  }) => Promise<{ daily: AdsDailyRow[]; partial: boolean }>
  readProductCampaignIds: (request: {
    readonly shopId: string
    readonly adType?: string
    readonly offset?: number
    readonly limit?: number
  }) => Promise<{ campaigns: ProductCampaignId[]; hasNextPage: boolean }>
  readProductCampaignSettings: (request: {
    readonly shopId: string
    readonly campaignIds: readonly number[]
    readonly infoTypes?: string
  }) => Promise<ProductCampaignSetting[]>
  readGmsDeletedItems: (request: {
    readonly shopId: string
    readonly offset?: number
    readonly limit?: number
  }) => Promise<{ campaignId?: number; itemIds: number[]; total?: number; hasNextPage: boolean }>
  readGmsCampaignPerformance: (request: {
    readonly shopId: string
    readonly startDate: string
    readonly endDate: string
    readonly campaignId?: number
  }) => Promise<{ campaignId?: number; report: GmsReport }>
  readGmsItemPerformance: (request: {
    readonly shopId: string
    readonly startDate: string
    readonly endDate: string
    readonly campaignId?: number
    readonly offset?: number
    readonly limit?: number
  }) => Promise<{
    campaignId?: number
    items: GmsItemPerformance[]
    total?: number
    hasNextPage: boolean
  }>
  readAdsRaw: (request: {
    readonly shopId: string
    readonly startDate: string
    readonly endDate: string
  }) => Promise<AdsRaw>
}

// Untouched provider bodies for the implemented Ads read endpoints, for a raw
// inspection view. Each section is captured independently so one failing call
// still shows the others.
export type AdsRaw = {
  dailyPerformance: unknown
  productCampaignIdList: unknown
  productCampaignSettingInfo: unknown
  gmsCampaignPerformance: unknown
  gmsItemPerformance: unknown
  gmsDeletedItem: unknown
}

type CallContext = {
  readonly baseUrl: string
  readonly partnerId: string
  readonly partnerKey: string
  readonly fetchImpl: typeof fetch
  readonly access: ShopeeCatalogAccess
  readonly externalShopId: ShopeeShopId
}

async function callAds(
  context: CallContext,
  method: "GET" | "POST",
  path: string,
  options: { query?: Record<string, string>; body?: Record<string, unknown> },
): Promise<unknown> {
  const timestamp = Math.floor(Date.now() / 1000)
  const sign = createHmac("sha256", context.partnerKey)
    .update(
      `${context.partnerId}${path}${timestamp}${context.access.accessToken}${context.externalShopId}`,
    )
    .digest("hex")
  const url = new URL(path, context.baseUrl)
  for (const [key, value] of Object.entries({
    ...options.query,
    partner_id: context.partnerId,
    timestamp: String(timestamp),
    access_token: context.access.accessToken,
    shop_id: context.externalShopId,
    sign,
  }))
    url.searchParams.set(key, value)
  const response = await context.fetchImpl(url, {
    method,
    headers:
      method === "POST"
        ? { "content-type": "application/json", accept: "application/json" }
        : { accept: "application/json" },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  })
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    throw new ShopeeAdsProviderError(providerErrorCode(body) ?? `http_${response.status}`)
  }
  return body
}

function providerErrorCode(body: unknown): string | undefined {
  if (body !== null && typeof body === "object" && "error" in body) {
    const value = (body as { error?: unknown }).error
    if (typeof value === "string" && value.length > 0 && value !== "-") return safeCode(value)
  }
  return undefined
}

const num = z.number().optional()

const ProductCampaignIdSchema = z.object({
  error: z.string().optional(),
  warning: z.string().optional(),
  response: z
    .object({
      has_next_page: z.boolean().optional(),
      campaign_list: z
        .array(z.object({ ad_type: z.string().optional(), campaign_id: z.number() }))
        .optional(),
    })
    .optional(),
})

const CampaignSettingSchema = z.object({
  error: z.string().optional(),
  warning: z.string().optional(),
  response: z
    .object({
      campaign_list: z
        .array(
          z.object({
            campaign_id: z.number(),
            common_info: z
              .object({
                ad_type: z.string().optional(),
                ad_name: z.string().optional(),
                campaign_status: z.string().optional(),
                bidding_method: z.string().optional(),
                campaign_placement: z.string().optional(),
                campaign_budget: num,
                campaign_duration: z
                  .object({ start_time: num, end_time: num })
                  .passthrough()
                  .optional(),
                item_id_list: z.array(z.number()).optional(),
              })
              .passthrough()
              .optional(),
            auto_bidding_info: z.object({ roas_target: num }).passthrough().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
})

const GmsReportSchema = z
  .object({
    expense: num,
    broad_gmv: num,
    broad_order: num,
    broad_roi: num,
    direct_order: num,
    direct_roi: num,
    clicks: num,
    impression: num,
    cpc: num,
    cr: num,
  })
  .passthrough()

const GmsDeletedSchema = z.object({
  error: z.string().optional(),
  warning: z.string().optional(),
  response: z
    .object({
      campaign_id: num,
      item_id_list: z.array(z.number()).optional(),
      total: num,
      has_next_page: z.boolean().optional(),
    })
    .optional(),
})

const GmsCampaignSchema = z.object({
  error: z.string().optional(),
  warning: z.string().optional(),
  response: z.object({ campaign_id: num, report: GmsReportSchema.optional() }).optional(),
})

const GmsItemSchema = z.object({
  error: z.string().optional(),
  warning: z.string().optional(),
  response: z
    .object({
      campaign_id: num,
      result_list: z
        .array(z.object({ item_id: num, report: GmsReportSchema.optional() }))
        .optional(),
      total: num,
      has_next_page: z.boolean().optional(),
    })
    .optional(),
})

function mapReport(input: z.infer<typeof GmsReportSchema> | undefined): GmsReport {
  if (input === undefined) return {}
  return {
    ...(input.expense === undefined ? {} : { expense: input.expense }),
    ...(input.broad_gmv === undefined ? {} : { broadGmv: input.broad_gmv }),
    ...(input.broad_order === undefined ? {} : { broadOrder: input.broad_order }),
    ...(input.broad_roi === undefined ? {} : { broadRoi: input.broad_roi }),
    ...(input.direct_order === undefined ? {} : { directOrder: input.direct_order }),
    ...(input.direct_roi === undefined ? {} : { directRoi: input.direct_roi }),
    ...(input.clicks === undefined ? {} : { clicks: input.clicks }),
    ...(input.impression === undefined ? {} : { impression: input.impression }),
    ...(input.cpc === undefined ? {} : { cpc: input.cpc }),
    ...(input.cr === undefined ? {} : { cr: input.cr }),
  }
}

export function createShopeeAdsReader(input: {
  readonly baseUrl: string
  readonly partnerId: string
  readonly partnerKey: string
  readonly resolveAccess: ShopeeCatalogAccessResolver
  readonly fetchImpl?: typeof fetch
}): ShopeeAdsReader {
  const fetchImpl = input.fetchImpl ?? fetch
  async function context(shopId: string): Promise<CallContext> {
    const access = await input.resolveAccess(shopId)
    return {
      baseUrl: input.baseUrl,
      partnerId: input.partnerId,
      partnerKey: input.partnerKey,
      fetchImpl,
      access,
      externalShopId: ShopeeShopIdSchema.parse(access.shop.externalShopId),
    }
  }

  return {
    async readDaily(request) {
      const ctx = await context(request.shopId)
      const body = await callAds(ctx, "GET", DAILY_PERFORMANCE_PATH, {
        query: { start_date: request.startDate, end_date: request.endDate },
      })
      return parseAdsDailyResponse(body)
    },

    async readProductCampaignIds(request) {
      const ctx = await context(request.shopId)
      const body = await callAds(ctx, "GET", PRODUCT_CAMPAIGN_ID_LIST_PATH, {
        query: {
          ad_type: request.adType ?? "all",
          offset: String(request.offset ?? 0),
          limit: String(request.limit ?? 5000),
        },
      })
      const parsed = ProductCampaignIdSchema.safeParse(body)
      if (!parsed.success) throw new ShopeeAdsProviderError("ads_malformed_response")
      assertEnvelope(parsed.data.error, parsed.data.warning)
      const campaigns = (parsed.data.response?.campaign_list ?? []).map((entry) => ({
        campaignId: entry.campaign_id,
        ...(entry.ad_type === undefined ? {} : { adType: entry.ad_type }),
      }))
      return { campaigns, hasNextPage: Boolean(parsed.data.response?.has_next_page) }
    },

    async readProductCampaignSettings(request) {
      if (request.campaignIds.length === 0) return []
      const ctx = await context(request.shopId)
      const body = await callAds(ctx, "GET", PRODUCT_CAMPAIGN_SETTING_PATH, {
        query: {
          info_type_list: request.infoTypes ?? "1,3",
          campaign_id_list: request.campaignIds.slice(0, 100).join(","),
        },
      })
      const parsed = CampaignSettingSchema.safeParse(body)
      if (!parsed.success) throw new ShopeeAdsProviderError("ads_malformed_response")
      assertEnvelope(parsed.data.error, parsed.data.warning)
      return (parsed.data.response?.campaign_list ?? []).map((entry) => {
        const common = entry.common_info
        return {
          campaignId: entry.campaign_id,
          itemIds: common?.item_id_list ?? [],
          ...(common?.ad_type === undefined ? {} : { adType: common.ad_type }),
          ...(common?.ad_name === undefined ? {} : { adName: common.ad_name }),
          ...(common?.campaign_status === undefined
            ? {}
            : { campaignStatus: common.campaign_status }),
          ...(common?.bidding_method === undefined ? {} : { biddingMethod: common.bidding_method }),
          ...(common?.campaign_placement === undefined
            ? {}
            : { campaignPlacement: common.campaign_placement }),
          ...(common?.campaign_budget === undefined
            ? {}
            : { campaignBudget: common.campaign_budget }),
          ...(common?.campaign_duration?.start_time === undefined
            ? {}
            : { startTime: common.campaign_duration.start_time }),
          ...(common?.campaign_duration?.end_time === undefined
            ? {}
            : { endTime: common.campaign_duration.end_time }),
          ...(entry.auto_bidding_info?.roas_target === undefined
            ? {}
            : { roasTarget: entry.auto_bidding_info.roas_target }),
        }
      })
    },

    async readGmsDeletedItems(request) {
      const ctx = await context(request.shopId)
      const body = await callAds(ctx, "POST", GMS_DELETED_ITEM_PATH, {
        body: { offset: request.offset ?? 0, limit: request.limit ?? 100 },
      })
      const parsed = GmsDeletedSchema.safeParse(body)
      if (!parsed.success) throw new ShopeeAdsProviderError("ads_malformed_response")
      assertEnvelope(parsed.data.error, parsed.data.warning)
      return {
        itemIds: parsed.data.response?.item_id_list ?? [],
        hasNextPage: Boolean(parsed.data.response?.has_next_page),
        ...(parsed.data.response?.campaign_id === undefined
          ? {}
          : { campaignId: parsed.data.response.campaign_id }),
        ...(parsed.data.response?.total === undefined ? {} : { total: parsed.data.response.total }),
      }
    },

    async readGmsCampaignPerformance(request) {
      const ctx = await context(request.shopId)
      const body = await callAds(ctx, "POST", GMS_CAMPAIGN_PERFORMANCE_PATH, {
        body: {
          start_date: request.startDate,
          end_date: request.endDate,
          ...(request.campaignId === undefined ? {} : { campaign_id: request.campaignId }),
        },
      })
      const parsed = GmsCampaignSchema.safeParse(body)
      if (!parsed.success) throw new ShopeeAdsProviderError("ads_malformed_response")
      assertEnvelope(parsed.data.error, parsed.data.warning)
      return {
        report: mapReport(parsed.data.response?.report),
        ...(parsed.data.response?.campaign_id === undefined
          ? {}
          : { campaignId: parsed.data.response.campaign_id }),
      }
    },

    async readGmsItemPerformance(request) {
      const ctx = await context(request.shopId)
      const body = await callAds(ctx, "POST", GMS_ITEM_PERFORMANCE_PATH, {
        body: {
          start_date: request.startDate,
          end_date: request.endDate,
          offset: request.offset ?? 0,
          limit: request.limit ?? 50,
          ...(request.campaignId === undefined ? {} : { campaign_id: request.campaignId }),
        },
      })
      const parsed = GmsItemSchema.safeParse(body)
      if (!parsed.success) throw new ShopeeAdsProviderError("ads_malformed_response")
      assertEnvelope(parsed.data.error, parsed.data.warning)
      const items = (parsed.data.response?.result_list ?? []).map((entry) => ({
        report: mapReport(entry.report),
        ...(entry.item_id === undefined ? {} : { itemId: entry.item_id }),
      }))
      return {
        items,
        hasNextPage: Boolean(parsed.data.response?.has_next_page),
        ...(parsed.data.response?.campaign_id === undefined
          ? {}
          : { campaignId: parsed.data.response.campaign_id }),
        ...(parsed.data.response?.total === undefined ? {} : { total: parsed.data.response.total }),
      }
    },

    async readAdsRaw(request) {
      const ctx = await context(request.shopId)
      const [
        dailyPerformance,
        productCampaignIdList,
        gmsCampaignPerformance,
        gmsItemPerformance,
        gmsDeletedItem,
      ] = await Promise.all([
        rawSection(ctx, "GET", DAILY_PERFORMANCE_PATH, {
          query: { start_date: request.startDate, end_date: request.endDate },
        }),
        rawSection(ctx, "GET", PRODUCT_CAMPAIGN_ID_LIST_PATH, {
          query: { ad_type: "all", offset: "0", limit: "5000" },
        }),
        rawSection(ctx, "POST", GMS_CAMPAIGN_PERFORMANCE_PATH, {
          body: { start_date: request.startDate, end_date: request.endDate },
        }),
        rawSection(ctx, "POST", GMS_ITEM_PERFORMANCE_PATH, {
          body: { start_date: request.startDate, end_date: request.endDate, offset: 0, limit: 50 },
        }),
        rawSection(ctx, "POST", GMS_DELETED_ITEM_PATH, { body: { offset: 0, limit: 100 } }),
      ])
      const parsedIds = ProductCampaignIdSchema.safeParse(productCampaignIdList)
      const campaignIds = parsedIds.success
        ? (parsedIds.data.response?.campaign_list ?? [])
            .map((entry) => entry.campaign_id)
            .slice(0, 100)
        : []
      const productCampaignSettingInfo =
        campaignIds.length > 0
          ? await rawSection(ctx, "GET", PRODUCT_CAMPAIGN_SETTING_PATH, {
              query: { info_type_list: "1,2,3,4", campaign_id_list: campaignIds.join(",") },
            })
          : { note: "no_campaigns" }
      return {
        dailyPerformance,
        productCampaignIdList,
        productCampaignSettingInfo,
        gmsCampaignPerformance,
        gmsItemPerformance,
        gmsDeletedItem,
      }
    },
  }
}

// Return an untouched provider body, or an error marker when the call fails, so
// a raw-inspection view can show whatever each GMS endpoint returned.
async function rawSection(
  context: CallContext,
  method: "GET" | "POST",
  path: string,
  options: { query?: Record<string, string>; body?: Record<string, unknown> },
): Promise<unknown> {
  try {
    return await callAds(context, method, path, options)
  } catch (error) {
    return { error: error instanceof ShopeeAdsProviderError ? error.code : "section_failed", path }
  }
}
