import { z } from "zod"

const SHOPEE_GLOBAL_PRODUCTION_AUTHORIZATION_URL = "https://open.shopee.com/auth"

const InputSchema = z
  .object({
    partnerId: z.string().regex(/^[1-9][0-9]*$/),
    redirectUri: z.string().url(),
    state: z.string().trim().min(1).max(4_096),
  })
  .strict()

export type ShopeeSellerAuthorizationUrlInput = z.input<typeof InputSchema>

export class ShopeeAuthorizationUrlError extends Error {
  readonly name = "ShopeeAuthorizationUrlError"
  readonly reason: "invalid_input" | "invalid_live_redirect_uri"

  constructor(reason: ShopeeAuthorizationUrlError["reason"]) {
    super("Shopee seller authorization URL could not be built")
    this.reason = reason
  }
}

export function buildShopeeSellerAuthorizationUrl(
  input: ShopeeSellerAuthorizationUrlInput,
): string {
  const parsed = InputSchema.safeParse(input)
  if (!parsed.success) throw new ShopeeAuthorizationUrlError("invalid_input")
  const redirectUri = parseLiveRedirectUri(parsed.data.redirectUri)
  const url = new URL(SHOPEE_GLOBAL_PRODUCTION_AUTHORIZATION_URL)
  url.searchParams.set("partner_id", parsed.data.partnerId)
  url.searchParams.set("auth_type", "seller")
  url.searchParams.set("redirect_uri", redirectUri)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("state", parsed.data.state)
  return url.toString()
}

function parseLiveRedirectUri(value: string): string {
  const url = new URL(value)
  if (
    url.protocol !== "https:" ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.hash.length > 0
  ) {
    throw new ShopeeAuthorizationUrlError("invalid_live_redirect_uri")
  }
  return url.toString()
}
