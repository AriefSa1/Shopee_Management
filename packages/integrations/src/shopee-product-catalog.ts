import { createHmac } from "node:crypto"
import { z } from "zod"
import {
  CatalogCursorSchema,
  type CatalogPage,
  type CatalogPageRequest,
  CatalogPageSchema,
  type CatalogProduct,
  CatalogProductIdSchema,
  CatalogVariantFixtureSchema,
  CatalogVariantIdSchema,
  type OfficialCatalogReadAdapter,
} from "../../catalog/src/catalog.ts"
import { type ShopeeShopId, ShopeeShopIdSchema } from "./shopee-oauth.ts"

const ProductListResponseSchema = z
  .object({
    error: z.string().optional(),
    message: z.string().optional(),
    request_id: z.string().optional(),
    response: z
      .object({
        item: z.array(z.object({ item_id: z.number().int().positive() }).passthrough()).optional(),
        item_list: z
          .array(z.object({ item_id: z.number().int().positive() }).passthrough())
          .optional(),
        has_next_page: z.boolean().optional(),
        next_offset: z.number().int().nonnegative().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()

const ItemBaseInfoResponseSchema = z
  .object({
    error: z.string().optional(),
    message: z.string().optional(),
    request_id: z.string().optional(),
    response: z
      .object({
        item_list: z
          .array(
            z
              .object({
                item_id: z.number().int().positive(),
                item_name: z.string().trim().min(1),
                item_status: z.string().optional(),
                stock: z.number().int().nonnegative().optional(),
                category_id: z.number().int().positive().optional(),
                models: z
                  .array(
                    z
                      .object({
                        model_id: z.number().int().positive(),
                        model_name: z.string().trim().min(1).optional(),
                        stock: z.number().int().nonnegative().optional(),
                      })
                      .passthrough(),
                  )
                  .optional(),
              })
              .passthrough(),
          )
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()

export type ShopeeCatalogShop = {
  readonly externalShopId: ShopeeShopId
  readonly market: string
}

export type ShopeeCatalogAccess = {
  readonly accessToken: string
  readonly shop: ShopeeCatalogShop
}

export type ShopeeCatalogAccessResolver = (shopId: string) => Promise<ShopeeCatalogAccess>

export class ShopeeCatalogProviderError extends Error {
  readonly name = "ShopeeCatalogProviderError"
  readonly code: string
  readonly requestId?: string

  constructor(code: string, requestId?: string) {
    super("Shopee catalog provider request failed")
    this.code = code
    if (requestId !== undefined) this.requestId = requestId
  }
}

export function createShopeeCatalogAdapter(input: {
  readonly baseUrl: string
  readonly partnerId: string
  readonly partnerKey: string
  readonly resolveAccess: ShopeeCatalogAccessResolver
  readonly fetchImpl?: typeof fetch
}): OfficialCatalogReadAdapter {
  const fetchImpl = input.fetchImpl ?? fetch
  return {
    capability: "enabled",
    async fetchPage(request: CatalogPageRequest): Promise<CatalogPage> {
      const access = await input.resolveAccess(request.shopId)
      const externalShopId = ShopeeShopIdSchema.parse(access.shop.externalShopId)
      const page = await readProductPage({ ...input, fetchImpl, access, externalShopId, request })
      return CatalogPageSchema.parse(page)
    },
  }
}

async function readProductPage(input: {
  readonly baseUrl: string
  readonly partnerId: string
  readonly partnerKey: string
  readonly fetchImpl: typeof fetch
  readonly access: ShopeeCatalogAccess
  readonly externalShopId: ShopeeShopId
  readonly request: CatalogPageRequest
}): Promise<CatalogPage> {
  const offset = input.request.cursor === undefined ? 0 : Number(input.request.cursor)
  if (!Number.isSafeInteger(offset) || offset < 0)
    throw new ShopeeCatalogProviderError("invalid_cursor")
  const list = await callShopee(input, "/api/v2/product/get_item_list", {
    offset: String(offset),
    page_size: "50",
    item_status: "NORMAL",
  })
  const parsedList = ProductListResponseSchema.safeParse(list)
  if (!parsedList.success) throw new ShopeeCatalogProviderError("malformed_item_list")
  assertProviderSuccess(parsedList.data.error, parsedList.data.request_id)
  const ids = (parsedList.data.response?.item_list ?? parsedList.data.response?.item ?? []).map(
    (item) => item.item_id,
  )
  const details =
    ids.length === 0
      ? []
      : await callShopee(input, "/api/v2/product/get_item_base_info", {
          // Shopee expects a comma-separated list, not a JSON array string.
          item_id_list: ids.join(","),
        })
  const parsedDetails = ItemBaseInfoResponseSchema.safeParse(details)
  if (!parsedDetails.success) throw new ShopeeCatalogProviderError("malformed_item_base_info")
  assertProviderSuccess(parsedDetails.data.error, parsedDetails.data.request_id)
  const mappedProducts = (parsedDetails.data.response?.item_list ?? []).map(mapProduct)
  const products = await attachEngagementStats(input, ids, mappedProducts)
  const hasNextPage = parsedList.data.response?.has_next_page === true
  const nextOffset = parsedList.data.response?.next_offset
  if (hasNextPage && nextOffset === undefined)
    throw new ShopeeCatalogProviderError("missing_next_offset", parsedList.data.request_id)
  return {
    products,
    hasNextPage,
    ...(hasNextPage ? { nextCursor: CatalogCursorSchema.parse(String(nextOffset)) } : {}),
  }
}

async function callShopee(
  input: {
    readonly baseUrl: string
    readonly partnerId: string
    readonly partnerKey: string
    readonly fetchImpl: typeof fetch
    readonly access: ShopeeCatalogAccess
    readonly externalShopId: ShopeeShopId
  },
  path: string,
  params: Record<string, string>,
): Promise<unknown> {
  const timestamp = Math.floor(Date.now() / 1000)
  const sign = createHmac("sha256", input.partnerKey)
    .update(
      `${input.partnerId}${path}${timestamp}${input.access.accessToken}${input.externalShopId}`,
    )
    .digest("hex")
  const url = new URL(path, input.baseUrl)
  for (const [key, value] of Object.entries({
    ...params,
    partner_id: input.partnerId,
    timestamp: String(timestamp),
    access_token: input.access.accessToken,
    shop_id: input.externalShopId,
    sign,
  }))
    url.searchParams.set(key, value)
  const response = await input.fetchImpl(url, { headers: { accept: "application/json" } })
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new ShopeeCatalogProviderError(`http_${response.status}`)
  }
  if (!response.ok) throw new ShopeeCatalogProviderError(`http_${response.status}`)
  return body
}

function assertProviderSuccess(error: string | undefined, requestId: string | undefined): void {
  if (error !== undefined && error !== "") throw new ShopeeCatalogProviderError(error, requestId)
}

const ItemExtraInfoResponseSchema = z
  .object({
    response: z
      .object({
        item_list: z
          .array(z.object({ item_id: z.number().int().positive() }).passthrough())
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()

async function attachEngagementStats(
  input: {
    readonly baseUrl: string
    readonly partnerId: string
    readonly partnerKey: string
    readonly fetchImpl: typeof fetch
    readonly access: ShopeeCatalogAccess
    readonly externalShopId: ShopeeShopId
  },
  ids: readonly number[],
  products: readonly CatalogProduct[],
): Promise<readonly CatalogProduct[]> {
  if (ids.length === 0) return products
  const stats = new Map<string, unknown>()
  try {
    const raw = await callShopee(input, "/api/v2/product/get_item_extra_info", {
      item_id_list: ids.join(","),
    })
    const parsed = ItemExtraInfoResponseSchema.safeParse(raw)
    if (parsed.success)
      for (const entry of parsed.data.response?.item_list ?? [])
        stats.set(String(entry.item_id), entry)
  } catch {
    // Engagement stats are best-effort enrichment; never fail the catalog page over them.
  }
  return products.map((product) =>
    stats.has(product.productId) ? { ...product, stats: stats.get(product.productId) } : product,
  )
}

function mapProduct(
  item: z.infer<typeof ItemBaseInfoResponseSchema>["response"] extends infer R
    ? NonNullable<R> extends { item_list?: infer L }
      ? L extends readonly (infer I)[]
        ? I
        : never
      : never
    : never,
): CatalogProduct {
  const variants = (item.models ?? []).map((model) => ({
    variantId: String(model.model_id),
    name: model.model_name ?? `Model ${model.model_id}`,
    ...(model.stock === undefined ? {} : { availableStock: model.stock }),
  }))
  const stock =
    item.stock ??
    (variants.length > 0
      ? variants.reduce((total, variant) => total + (variant.availableStock ?? 0), 0)
      : undefined)
  return {
    productId: CatalogProductIdSchema.parse(String(item.item_id)),
    name: item.item_name,
    publication:
      item.item_status === "NORMAL"
        ? "active"
        : item.item_status === undefined
          ? "unknown"
          : "inactive",
    ...(stock === undefined ? {} : { availableStock: stock }),
    variants: variants.map((variant) =>
      CatalogVariantFixtureSchema.parse({
        ...variant,
        variantId: CatalogVariantIdSchema.parse(variant.variantId),
      }),
    ),
    raw: item,
  }
}
