import type { PostgresExecutor } from "../../../packages/delivery/src/postgres-delivery.ts"
import { ShopIdSchema } from "../../../packages/identity/src/model.ts"
import { ShopeeCatalogProviderError } from "../../../packages/integrations/src/shopee-product-catalog.ts"
import type { ShopeeProductDetailReader } from "../../../packages/integrations/src/shopee-product-detail.ts"
import type { OAuthWebAuthContext } from "../../../packages/oauth/src/oauth-api.ts"

export type ProductDetailApiDependencies = {
  readonly authenticate: (request: Request) => OAuthWebAuthContext | null
  readonly executor: PostgresExecutor
  readonly reader: ShopeeProductDetailReader
}

export async function createProductDetailApiHandler(
  request: Request,
  dependencies: ProductDetailApiDependencies,
): Promise<Response> {
  const context = dependencies.authenticate(request)
  if (context === null) return json({ error: { code: "authentication_required" } }, 401)

  const query = new URL(request.url).searchParams
  const shopId = ShopIdSchema.safeParse(query.get("shopId"))
  const itemIdRaw = query.get("itemId")
  const itemId = itemIdRaw === null ? Number.NaN : Number(itemIdRaw)
  if (!shopId.success || !Number.isSafeInteger(itemId) || itemId <= 0)
    return json({ error: { code: "invalid_catalog_request" } }, 400)

  // Authorize: the requested shop must be an active connection in the operator's organization.
  const rows = await dependencies.executor.query({
    name: "web.product_detail.authorize_shop",
    text: "SELECT id FROM shop_connections WHERE id = $1 AND organization_id = $2 AND status = 'active'",
    params: [shopId.data, context.organizationId],
  })
  if (rows.length === 0) return json({ error: { code: "shop_not_accessible" } }, 403)

  try {
    const detail = await dependencies.reader.readItemDetail({ shopId: shopId.data, itemId })
    return json({ data: { shopId: shopId.data, itemId: detail.itemId, raw: detail.raw } }, 200)
  } catch (error) {
    if (error instanceof ShopeeCatalogProviderError) {
      return json(
        {
          error: {
            code: "catalog_provider_unavailable",
            providerCode: error.code,
            ...(error.requestId === undefined ? {} : { requestId: error.requestId }),
            retryable: true,
          },
        },
        502,
      )
    }
    if (error instanceof Error)
      return json({ error: { code: "catalog_provider_unavailable", retryable: true } }, 502)
    throw error
  }
}

function json(body: object, status: 200 | 400 | 401 | 403 | 502): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } })
}
