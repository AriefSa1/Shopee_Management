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
  const days = Number(query.get("days") ?? "7")
  if (!shopId.success || ![7, 14, 28].includes(days)) {
    return json({ error: { code: "invalid_ads_request" } }, 400)
  }

  const rows = await dependencies.executor.query({
    name: "web.ads.authorize_shop",
    text: "SELECT id FROM shop_connections WHERE id = $1 AND organization_id = $2 AND status = 'active'",
    params: [shopId.data, context.organizationId],
  })
  if (rows.length === 0) return json({ error: { code: "shop_not_accessible" } }, 403)

  const today = dateInJakarta((dependencies.now ?? (() => new Date()))())
  const start = new Date(today.getTime() - days * 86_400_000)
  const end = new Date(today.getTime() - 86_400_000)
  const startDate = shopeeDate(start)
  const endDate = shopeeDate(end)
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

function json(body: object, status: 200 | 400 | 401 | 403 | 502): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } })
}
