import {
  CatalogCursorSchema,
  CatalogFilterSchema,
  OrganizationIdSchema,
  ShopIdSchema,
  collectCatalogPages,
  filterCatalog,
  type CatalogReadContext,
  type OfficialCatalogReadAdapter,
} from "./catalog.ts"
import { ShopeeCatalogProviderError } from "../../integrations/src/shopee-product-catalog.ts"

export type CatalogApiDependencies = {
  readonly authenticate: (
    request: Request,
  ) => CatalogReadContext | null | Promise<CatalogReadContext | null>
  readonly adapter: OfficialCatalogReadAdapter
  readonly collectedAt: string
}

export async function createCatalogApiHandler(
  request: Request,
  dependencies: CatalogApiDependencies,
): Promise<Response> {
  const context = await dependencies.authenticate(request)
  if (context === null) return json({ error: { code: "authentication_required" } }, 401)

  const parsed = parseCatalogRequest(request)
  if (parsed.kind === "invalid") return json({ error: { code: "invalid_catalog_request" } }, 400)
  if (parsed.organizationId !== undefined && parsed.organizationId !== context.organizationId) {
    return json({ error: { code: "organization_mismatch" } }, 403)
  }

  try {
    const result = await collectCatalogPages({
      context,
      shopId: parsed.shopId,
      adapter: dependencies.adapter,
      collectedAt: dependencies.collectedAt,
      ...(parsed.cursor === undefined ? {} : { initialCursor: parsed.cursor }),
    })
    if (result.kind === "denied") return json({ error: { code: result.reason } }, 403)
    return json(
      {
        data: {
          organizationId: result.collection.organizationId,
          shopId: result.collection.shopId,
          collectedAt: result.collection.collectedAt,
          completeness: result.collection.completeness,
          products: filterCatalog(result.collection, parsed.filter),
        },
      },
      200,
    )
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

function parseCatalogRequest(
  request: Request,
):
  | {
      readonly kind: "valid"
      readonly organizationId?: ReturnType<typeof OrganizationIdSchema.parse>
      readonly shopId: ReturnType<typeof ShopIdSchema.parse>
      readonly cursor?: ReturnType<typeof CatalogCursorSchema.parse>
      readonly filter: ReturnType<typeof CatalogFilterSchema.parse>
    }
  | { readonly kind: "invalid" } {
  const query = new URL(request.url).searchParams
  const organizationIdValue = query.get("organizationId")
  const organizationId =
    organizationIdValue === null
      ? { success: true as const, data: undefined }
      : OrganizationIdSchema.safeParse(organizationIdValue)
  const shopId = ShopIdSchema.safeParse(query.get("shopId"))
  const cursorValue = query.get("cursor")
  const cursor =
    cursorValue === null
      ? { success: true as const, data: undefined }
      : CatalogCursorSchema.safeParse(cursorValue)
  const freshnessNow = query.get("freshnessNow")
  const maximumAgeMinutes = query.get("maximumAgeMinutes")
  const filter = CatalogFilterSchema.safeParse({
    ...(query.get("query") === null ? {} : { query: query.get("query") }),
    ...(query.get("publication") === null ? {} : { publication: query.get("publication") }),
    ...(query.get("stock") === null ? {} : { stock: query.get("stock") }),
    ...(freshnessNow === null || maximumAgeMinutes === null
      ? {}
      : { freshness: { now: freshnessNow, maximumAgeMinutes: Number(maximumAgeMinutes) } }),
  })
  if (!organizationId.success || !shopId.success || !cursor.success || !filter.success)
    return { kind: "invalid" }
  return {
    kind: "valid",
    ...(organizationId.data === undefined ? {} : { organizationId: organizationId.data }),
    shopId: shopId.data,
    ...(cursor.data === undefined ? {} : { cursor: cursor.data }),
    filter: filter.data,
  }
}

function json(body: object, status: 200 | 400 | 401 | 403 | 502): Response {
  return Response.json(body, { status })
}
