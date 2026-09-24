import type { PostgresExecutor } from "../../../packages/delivery/src/postgres-delivery.ts"
import { ShopIdSchema } from "../../../packages/identity/src/model.ts"
import type {
  HotListingPeriod,
  ShopeeMarketingInsightsReader,
} from "../../../packages/integrations/src/shopee-business-insights.ts"
import { ShopeeCatalogProviderError } from "../../../packages/integrations/src/shopee-product-catalog.ts"
import type { OAuthWebAuthContext } from "../../../packages/oauth/src/oauth-api.ts"

export type MarketingInsightsApiDependencies = {
  readonly authenticate: (request: Request) => OAuthWebAuthContext | null
  readonly executor: PostgresExecutor
  readonly reader: ShopeeMarketingInsightsReader
}

const DAY_SECONDS = 86_400
const DATE_RE = /^(\d{2})-(\d{2})-(\d{4})$/

// The hot-listing API takes the range as Unix seconds; the DD-MM-YYYY strings
// from the shared range picker are converted to day boundaries.
function toUnix(value: string | null, endOfDay: boolean): number | undefined {
  if (value === null) return undefined
  const match = DATE_RE.exec(value)
  if (match === null) return undefined
  const base = Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]), 0, 0, 0)
  if (!Number.isFinite(base)) return undefined
  return Math.floor(base / 1000) + (endOfDay ? DAY_SECONDS - 1 : 0)
}

// `period` is a required label alongside the explicit time range; derive the
// closest preset from the span.
function derivePeriod(startTime: number, endTime: number): HotListingPeriod {
  const spanDays = (endTime - startTime) / DAY_SECONDS
  if (spanDays <= 1) return "yesterday"
  if (spanDays <= 7) return "past7days"
  return "past30days"
}

export async function createMarketingInsightsApiHandler(
  request: Request,
  dependencies: MarketingInsightsApiDependencies,
): Promise<Response> {
  const context = dependencies.authenticate(request)
  if (context === null) return json({ error: { code: "authentication_required" } }, 401)

  const query = new URL(request.url).searchParams
  const shopId = ShopIdSchema.safeParse(query.get("shopId"))
  const startDate = query.get("startDate")
  const endDate = query.get("endDate")
  const startTime = toUnix(startDate, false)
  const endTime = toUnix(endDate, true)
  if (!shopId.success || startTime === undefined || endTime === undefined || endTime < startTime) {
    return json({ error: { code: "invalid_insights_request" } }, 400)
  }

  const rows = await dependencies.executor.query({
    name: "web.marketing_insights.authorize_shop",
    text: "SELECT id FROM shop_connections WHERE id = $1 AND organization_id = $2 AND status = 'active'",
    params: [shopId.data, context.organizationId],
  })
  if (rows.length === 0) return json({ error: { code: "shop_not_accessible" } }, 403)

  const period = derivePeriod(startTime, endTime)
  try {
    const result = await dependencies.reader.readHotListing({
      shopId: shopId.data,
      period,
      startTime,
      endTime,
    })
    return json({ data: { shopId: shopId.data, period, startDate, endDate, ...result } }, 200)
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
