import type { PostgresExecutor } from "../../../packages/delivery/src/postgres-delivery.ts"
import { ShopIdSchema } from "../../../packages/identity/src/model.ts"
import {
  ShopeeAdsProviderError,
  type ShopeeAdsReader,
} from "../../../packages/integrations/src/shopee-ads.ts"
import { ShopeeCatalogProviderError } from "../../../packages/integrations/src/shopee-product-catalog.ts"
import type { OAuthWebAuthContext } from "../../../packages/oauth/src/oauth-api.ts"

export type AdsApiDependencies = {
  readonly authenticate: (request: Request) => OAuthWebAuthContext | null
  readonly executor: PostgresExecutor
  readonly reader: ShopeeAdsReader
  readonly now?: () => Date
}

function dateInJakarta(now: Date): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now)
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value)
  return new Date(Date.UTC(value("year"), value("month") - 1, value("day")))
}

function shopeeDate(day: Date): string {
  const date = String(day.getUTCDate()).padStart(2, "0")
  const month = String(day.getUTCMonth() + 1).padStart(2, "0")
  return `${date}-${month}-${day.getUTCFullYear()}`
}

export async function createAdsDailyApiHandler(
  request: Request,
  dependencies: AdsApiDependencies,
): Promise<Response> {
  const context = dependencies.authenticate(request)
  if (context === null) return json({ error: { code: "authentication_required" } }, 401)

  const query = new URL(request.url).searchParams
  const shopId = ShopIdSchema.safeParse(query.get("shopId"))
  const today = dateInJakarta((dependencies.now ?? (() => new Date()))())
  const startDate = query.get("startDate") ?? shopeeDate(new Date(today.getTime() - 7 * 86_400_000))
  const endDate = query.get("endDate") ?? shopeeDate(new Date(today.getTime() - 86_400_000))
  if (!shopId.success || !SHOPEE_DATE_RE.test(startDate) || !SHOPEE_DATE_RE.test(endDate)) {
    return json({ error: { code: "invalid_ads_request" } }, 400)
  }

  const rows = await dependencies.executor.query({
    name: "web.ads.authorize_shop",
    text: "SELECT id FROM shop_connections WHERE id = $1 AND organization_id = $2 AND status = 'active'",
    params: [shopId.data, context.organizationId],
  })
  if (rows.length === 0) return json({ error: { code: "shop_not_accessible" } }, 403)

  try {
    const result = await dependencies.reader.readDaily({ shopId: shopId.data, startDate, endDate })
    return json({ data: { shopId: shopId.data, startDate, endDate, ...result } }, 200)
  } catch (error) {
    if (error instanceof ShopeeAdsProviderError || error instanceof ShopeeCatalogProviderError) {
      return json({ error: { code: "ads_provider_unavailable", providerCode: error.code } }, 502)
    }
    if (error instanceof Error) {
      return json({ error: { code: "ads_provider_unavailable" } }, 502)
    }
    throw error
  }
}

async function authorizeShop(
  request: Request,
  dependencies: AdsApiDependencies,
): Promise<
  | { readonly kind: "ok"; readonly shopId: ReturnType<typeof ShopIdSchema.parse> }
  | { readonly kind: "error"; readonly response: Response }
> {
  const context = dependencies.authenticate(request)
  if (context === null) {
    return { kind: "error", response: json({ error: { code: "authentication_required" } }, 401) }
  }
  const shopId = ShopIdSchema.safeParse(new URL(request.url).searchParams.get("shopId"))
  if (!shopId.success) {
    return { kind: "error", response: json({ error: { code: "invalid_ads_request" } }, 400) }
  }
  const rows = await dependencies.executor.query({
    name: "web.ads.authorize_shop",
    text: "SELECT id FROM shop_connections WHERE id = $1 AND organization_id = $2 AND status = 'active'",
    params: [shopId.data, context.organizationId],
  })
  if (rows.length === 0) {
    return { kind: "error", response: json({ error: { code: "shop_not_accessible" } }, 403) }
  }
  return { kind: "ok", shopId: shopId.data }
}

function adsFailure(error: unknown): Response {
  if (error instanceof ShopeeAdsProviderError || error instanceof ShopeeCatalogProviderError) {
    return json({ error: { code: "ads_provider_unavailable", providerCode: error.code } }, 502)
  }
  if (error instanceof Error) return json({ error: { code: "ads_provider_unavailable" } }, 502)
  throw error
}

export async function createAdsProductCampaignsApiHandler(
  request: Request,
  dependencies: AdsApiDependencies,
): Promise<Response> {
  const auth = await authorizeShop(request, dependencies)
  if (auth.kind === "error") return auth.response
  const adTypeRaw = new URL(request.url).searchParams.get("adType") ?? "all"
  const adType = ["all", "auto", "manual"].includes(adTypeRaw) ? adTypeRaw : "all"
  try {
    const ids = await dependencies.reader.readProductCampaignIds({ shopId: auth.shopId, adType })
    const campaigns = await dependencies.reader.readProductCampaignSettings({
      shopId: auth.shopId,
      campaignIds: ids.campaigns.map((campaign) => campaign.campaignId),
    })
    return json({ data: { shopId: auth.shopId, campaigns, hasNextPage: ids.hasNextPage } }, 200)
  } catch (error) {
    return adsFailure(error)
  }
}

const SHOPEE_DATE_RE = /^\d{2}-\d{2}-\d{4}$/

export async function createAdsRawApiHandler(
  request: Request,
  dependencies: AdsApiDependencies,
): Promise<Response> {
  const auth = await authorizeShop(request, dependencies)
  if (auth.kind === "error") return auth.response
  const query = new URL(request.url).searchParams
  const today = dateInJakarta((dependencies.now ?? (() => new Date()))())
  const startDate = query.get("startDate") ?? shopeeDate(new Date(today.getTime() - 7 * 86_400_000))
  const endDate = query.get("endDate") ?? shopeeDate(new Date(today.getTime() - 86_400_000))
  if (!SHOPEE_DATE_RE.test(startDate) || !SHOPEE_DATE_RE.test(endDate)) {
    return json({ error: { code: "invalid_ads_request" } }, 400)
  }
  try {
    const raw = await dependencies.reader.readAdsRaw({ shopId: auth.shopId, startDate, endDate })
    return json({ data: { shopId: auth.shopId, startDate, endDate, raw } }, 200)
  } catch (error) {
    return adsFailure(error)
  }
}

function json(body: object, status: 200 | 400 | 401 | 403 | 502): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } })
}
