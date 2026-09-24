import { createHmac } from "node:crypto"
import { z } from "zod"

const TOKEN_PATH = "/api/v2/auth/token/get"
export const ShopeeShopIdSchema = z.string().regex(/^[1-9]\d*$/).brand("ShopeeShopId")
export type ShopeeShopId = z.infer<typeof ShopeeShopIdSchema>

const RequestInputSchema = z
  .object({
    baseUrl: z.string().url(),
    partnerId: z.string().regex(/^[1-9]\d*$/),
    partnerKey: z.string().trim().min(1),
    shopId: ShopeeShopIdSchema,
    code: z.string().trim().min(1).max(4096),
    timestamp: z.number().int().nonnegative(),
  })
  .strict()

const ResponseSchema = z
  .object({
    request_id: z.string().trim().min(1).optional(),
    error: z.string().optional(),
    access_token: z.string().trim().min(1).optional(),
    refresh_token: z.string().trim().min(1).optional(),
    expire_in: z.number().int().positive().optional(),
  })
  .passthrough()

const SafeErrorCodeSchema = z.string().regex(/^[a-z0-9_:-]{1,128}$/i)

export type ShopeeTokenExchangeRequest = {
  readonly method: "POST"
  readonly url: string
  readonly headers: Readonly<Record<"content-type", "application/json">>
  readonly body: string
}

export type ShopeeTokenExchangeResult =
  | {
      readonly kind: "succeeded"
      readonly requestId?: string
      readonly accessToken: string
      readonly refreshToken: string
      readonly expiresIn: number
    }
  | {
      readonly kind: "rejected"
      readonly requestId?: string
      readonly code: string
    }

export class ShopeeOAuthRequestError extends Error {
  readonly name = "ShopeeOAuthRequestError"
  readonly reason: "invalid_input"

  constructor(reason: ShopeeOAuthRequestError["reason"]) {
    super("Shopee OAuth request input is invalid")
    this.reason = reason
  }
}

export class ShopeeOAuthResponseError extends Error {
  readonly name = "ShopeeOAuthResponseError"
  readonly reason: "malformed_response" | "invalid_success_payload"

  constructor(reason: ShopeeOAuthResponseError["reason"]) {
    super("Shopee OAuth response is invalid")
    this.reason = reason
  }
}

export function buildShopeeTokenExchangeRequest(
  input: z.input<typeof RequestInputSchema>,
): ShopeeTokenExchangeRequest {
  const parsed = RequestInputSchema.safeParse(input)
  if (!parsed.success) throw new ShopeeOAuthRequestError("invalid_input")
  const partnerId = parseSafeInteger(parsed.data.partnerId)
  const shopId = parseSafeInteger(parsed.data.shopId)
  if (partnerId === undefined || shopId === undefined) {
    throw new ShopeeOAuthRequestError("invalid_input")
  }

  const timestamp = String(parsed.data.timestamp)
  const signatureBase = `${parsed.data.partnerId}${TOKEN_PATH}${timestamp}`
  const sign = createHmac("sha256", parsed.data.partnerKey).update(signatureBase).digest("hex")
  const url = new URL(TOKEN_PATH, parsed.data.baseUrl)
  url.searchParams.set("partner_id", parsed.data.partnerId)
  url.searchParams.set("timestamp", timestamp)
  url.searchParams.set("sign", sign)
  return {
    method: "POST",
    url: url.toString(),
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code: parsed.data.code,
      partner_id: partnerId,
      shop_id: shopId,
    }),
  }
}

export function parseShopeeTokenExchangeResponse(input: unknown): ShopeeTokenExchangeResult {
  const parsed = ResponseSchema.safeParse(input)
  if (!parsed.success) throw new ShopeeOAuthResponseError("malformed_response")
  const requestId = parsed.data.request_id
  if (parsed.data.error !== undefined && parsed.data.error.length > 0) {
    const safeCode = SafeErrorCodeSchema.safeParse(parsed.data.error)
    return {
      kind: "rejected",
      ...(requestId === undefined ? {} : { requestId }),
      code: safeCode.success ? safeCode.data : "provider_error",
    }
  }
  if (
    parsed.data.access_token === undefined ||
    parsed.data.refresh_token === undefined ||
    parsed.data.expire_in === undefined
  ) {
    throw new ShopeeOAuthResponseError("invalid_success_payload")
  }
  return {
    kind: "succeeded",
    ...(requestId === undefined ? {} : { requestId }),
    accessToken: parsed.data.access_token,
    refreshToken: parsed.data.refresh_token,
    expiresIn: parsed.data.expire_in,
  }
}

function parseSafeInteger(value: string): number | undefined {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}
