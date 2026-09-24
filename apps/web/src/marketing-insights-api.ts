import type { PostgresExecutor } from "../../../packages/delivery/src/postgres-delivery.ts"
import { ShopIdSchema } from "../../../packages/identity/src/model.ts"
import {
  HOT_LISTING_PERIODS,
  type HotListingPeriod,
  type ShopeeMarketingInsightsReader,
} from "../../../packages/integrations/src/shopee-business-insights.ts"
import { ShopeeCatalogProviderError } from "../../../packages/integrations/src/shopee-product-catalog.ts"
import type { OAuthWebAuthContext } from "../../../packages/oauth/src/oauth-api.ts"

export type MarketingInsightsApiDependencies = {
  readonly authenticate: (request: Request) => OAuthWebAuthContext | null
  readonly executor: PostgresExecutor
  readonly reader: ShopeeMarketingInsightsReader
}

const DAY_SECONDS = 86_400

function isPeriod(value: string | null): value is HotListingPeriod {
  return value !== null && (HOT_LISTING_PERIODS as readonly string[]).includes(value)
}

function periodRange(
  period: HotListingPeriod,
  nowSeconds: number,
): {
  readonly startTime: number
  readonly endTime: number
} {
  const startOfToday = nowSeconds - (nowSeconds % DAY_SECONDS)
  switch (period) {
    case "real_time":
      return { startTime: startOfToday, endTime: nowSeconds }
    case "yesterday":
      return { startTime: startOfToday - DAY_SECONDS, endTime: startOfToday - 1 }
    case "past7days":
      return { startTime: nowSeconds - 7 * DAY_SECONDS, endTime: nowSeconds }
    case "past30days":
      return { startTime: nowSeconds - 30 * DAY_SECONDS, endTime: nowSeconds }
  }
}

export async function createMarketingInsightsApiHandler(
  request: Request,
  dependencies: MarketingInsightsApiDependencies,
): Promise<Response> {
  const context = dependencies.authenticate(request)
  if (context === null) return json({ error: { code: "authentication_required" } }, 401)

  const query = new URL(request.url).searchParams
  const shopId = ShopIdSchema.safeParse(query.get("shopId"))
  const periodValue = query.get("period") ?? "past7days"
  if (!shopId.success || !isPeriod(periodValue)) {
    return json({ error: { code: "invalid_insights_request" } }, 400)
  }

  const rows = await dependencies.executor.query({
    name: "web.marketing_insights.authorize_shop",
    text: "SELECT id FROM shop_connections WHERE id = $1 AND organization_id = $2 AND status = 'active'",
    params: [shopId.data, context.organizationId],
  })
  if (rows.length === 0) return json({ error: { code: "shop_not_accessible" } }, 403)

  const range = periodRange(periodValue, Math.floor(Date.now() / 1000))
  try {
    const result = await dependencies.reader.readHotListing({
      shopId: shopId.data,
      period: periodValue,
      startTime: range.startTime,
      endTime: range.endTime,
    })
    return json({ data: { shopId: shopId.data, period: periodValue, ...result } }, 200)
  } catch (error) {
    if (error instanceof ShopeeCatalogProviderError) {
      return json(
        {
          error: {
            code: "insights_provider_unavailable",
            providerCode: error.code,
            retryable: true,
          },
        },
        502,
      )
    }
    if (error instanceof Error)
      return json({ error: { code: "insights_provider_unavailable", retryable: true } }, 502)
    throw error
  }
}

function json(body: object, status: 200 | 400 | 401 | 403 | 502): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } })
}
