export const SHOPEE_SECRET_NAMES = [
  "SHOPEE_PARTNER_ID",
  "SHOPEE_PARTNER_KEY",
  "SHOPEE_ACCESS_TOKEN",
  "SHOPEE_REFRESH_TOKEN",
] as const

export type ShopeeSecretName = (typeof SHOPEE_SECRET_NAMES)[number]

export interface ShopeeSecretProvider {
  get(name: ShopeeSecretName): Promise<string | undefined>
}
