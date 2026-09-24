import { createHmac } from "node:crypto"
import { type ShopeeShopId, ShopeeShopIdSchema } from "./shopee-oauth.ts"
import {
  type ShopeeCatalogAccess,
  type ShopeeCatalogAccessResolver,
  ShopeeCatalogProviderError,
} from "./shopee-product-catalog.ts"

/**
 * Read-only reader for the Shopee Product APIs that enrich a single item:
 * get_item_base_info, get_model_list (variants, price, stock),
 * get_item_extra_info (sales, views, likes) and get_item_promotion.
 *
 * Every section returns the untouched provider body so the UI can show all raw
 * response data without exception; a section that fails is captured as an error
 * object instead of aborting the others. No mutation endpoints are used.
 */
export type ShopeeProductDetailRequest = {
  readonly shopId: string
  readonly itemId: number
}

export type ShopeeProductDetail = {
  readonly itemId: number
  readonly raw: {
    readonly base_info: unknown
    readonly model_list: unknown
    readonly extra_info: unknown
    readonly promotion: unknown
  }
}

export type ShopeeProductDetailReader = {
  readItemDetail: (request: ShopeeProductDetailRequest) => Promise<ShopeeProductDetail>
}

export function createShopeeProductDetailReader(input: {
  readonly baseUrl: string
  readonly partnerId: string
  readonly partnerKey: string
  readonly resolveAccess: ShopeeCatalogAccessResolver
  readonly fetchImpl?: typeof fetch
}): ShopeeProductDetailReader {
  const fetchImpl = input.fetchImpl ?? fetch
  return {
    async readItemDetail(request: ShopeeProductDetailRequest): Promise<ShopeeProductDetail> {
      if (!Number.isSafeInteger(request.itemId) || request.itemId <= 0)
        throw new ShopeeCatalogProviderError("invalid_item_id")
      const access = await input.resolveAccess(request.shopId)
      const externalShopId = ShopeeShopIdSchema.parse(access.shop.externalShopId)
      const context = { ...input, fetchImpl, access, externalShopId }
      const itemId = String(request.itemId)
      const [baseInfo, modelList, extraInfo, promotion] = await Promise.all([
        section(context, "/api/v2/product/get_item_base_info", { item_id_list: itemId }),
        section(context, "/api/v2/product/get_model_list", { item_id: itemId }),
        section(context, "/api/v2/product/get_item_extra_info", { item_id_list: itemId }),
        section(context, "/api/v2/product/get_item_promotion", { item_id_list: itemId }),
      ])
      return {
        itemId: request.itemId,
        raw: {
          base_info: baseInfo,
          model_list: modelList,
          extra_info: extraInfo,
          promotion: promotion,
        },
      }
    },
  }
}

async function section(
  context: {
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
  try {
    return await callShopee(context, path, params)
  } catch (error) {
    // Surface a per-section failure without aborting the other sections.
    const code = error instanceof ShopeeCatalogProviderError ? error.code : "section_failed"
    return { error: code, section: path }
  }
}

async function callShopee(
  context: {
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
  const sign = createHmac("sha256", context.partnerKey)
    .update(
      `${context.partnerId}${path}${timestamp}${context.access.accessToken}${context.externalShopId}`,
    )
    .digest("hex")
  const url = new URL(path, context.baseUrl)
  for (const [key, value] of Object.entries({
    ...params,
    partner_id: context.partnerId,
    timestamp: String(timestamp),
    access_token: context.access.accessToken,
    shop_id: context.externalShopId,
    sign,
  }))
    url.searchParams.set(key, value)
  const response = await context.fetchImpl(url, { headers: { accept: "application/json" } })
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new ShopeeCatalogProviderError(`http_${response.status}`)
  }
  if (!response.ok) throw new ShopeeCatalogProviderError(`http_${response.status}`)
  return body
}
