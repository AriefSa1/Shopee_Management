import { createHmac } from "node:crypto"
import { z } from "zod"

// Shopee Open Platform GET /api/v2/shop/get_shop_info. Shop-scoped signed call:
// sign = HMAC-SHA256(partner_key, partner_id + path + timestamp + access_token + shop_id).
// Returns shop_name (the human-readable store name), region and status.

const SHOP_INFO_PATH = "/api/v2/shop/get_shop_info"

const RequestInputSchema = z
  .object({
    baseUrl: z.string().url(),
    partnerId: z.string().regex(/^[1-9]\d*$/),
    partnerKey: z.string().trim().min(1),
    shopId: z.string().regex(/^[1-9]\d*$/),
    accessToken: z.string().trim().min(1),
    timestamp: z.number().int().nonnegative(),
  })
  .strict()

const ResponseSchema = z
  .object({
    request_id: z.string().trim().min(1).optional(),
    error: z.string().optional(),
    shop_name: z.string().trim().min(1).optional(),
    region: z.string().optional(),
    status: z.string().optional(),
  })
  .passthrough()

const SafeErrorCodeSchema = z.string().regex(/^[a-z0-9_:-]{1,128}$/i)

export type ShopeeShopInfoRequest = {
  readonly method: "GET"
  readonly url: string
}

export type ShopeeShopInfoResult =
  | {
      readonly kind: "succeeded"
      readonly requestId?: string
      readonly shopName?: string
      readonly region?: string
      readonly status?: string
    }
  | { readonly kind: "rejected"; readonly requestId?: string; readonly code: string }

export class ShopeeShopInfoRequestError extends Error {
  readonly name = "ShopeeShopInfoRequestError"
  readonly reason = "invalid_input"
  constructor() {
    super("Shopee shop-info request input is invalid")
  }
}

export function buildShopeeShopInfoRequest(
  input: z.input<typeof RequestInputSchema>,
): ShopeeShopInfoRequest {
  const parsed = RequestInputSchema.safeParse(input)
  if (!parsed.success) throw new ShopeeShopInfoRequestError()
  const timestamp = String(parsed.data.timestamp)
  const signatureBase = `${parsed.data.partnerId}${SHOP_INFO_PATH}${timestamp}${parsed.data.accessToken}${parsed.data.shopId}`
  const sign = createHmac("sha256", parsed.data.partnerKey).update(signatureBase).digest("hex")
  const url = new URL(SHOP_INFO_PATH, parsed.data.baseUrl)
  url.searchParams.set("partner_id", parsed.data.partnerId)
  url.searchParams.set("timestamp", timestamp)
  url.searchParams.set("access_token", parsed.data.accessToken)
  url.searchParams.set("shop_id", parsed.data.shopId)
  url.searchParams.set("sign", sign)
  return { method: "GET", url: url.toString() }
}

export function parseShopeeShopInfoResponse(input: unknown): ShopeeShopInfoResult {
  const parsed = ResponseSchema.safeParse(input)
  if (!parsed.success) return { kind: "rejected", code: "malformed_response" }
  const requestId = parsed.data.request_id
  if (parsed.data.error !== undefined && parsed.data.error.length > 0) {
    const safeCode = SafeErrorCodeSchema.safeParse(parsed.data.error)
    return {
      kind: "rejected",
      ...(requestId === undefined ? {} : { requestId }),
      code: safeCode.success ? safeCode.data : "provider_error",
    }
  }
  return {
    kind: "succeeded",
    ...(requestId === undefined ? {} : { requestId }),
    ...(parsed.data.shop_name === undefined ? {} : { shopName: parsed.data.shop_name }),
    ...(parsed.data.region === undefined ? {} : { region: parsed.data.region }),
    ...(parsed.data.status === undefined ? {} : { status: parsed.data.status }),
  }
}
