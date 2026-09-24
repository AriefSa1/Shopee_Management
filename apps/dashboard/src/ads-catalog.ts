export type AdsEndpoint = {
  name: string
  area: "Akun" | "Rekomendasi" | "Performa" | "Iklan Produk" | "GMV Max"
  operation: "Baca" | "Aksi"
  offline?: boolean
  unavailable?: boolean
}

export const ADS_ENDPOINTS: readonly AdsEndpoint[] = [
  { name: "get_total_balance", area: "Akun", operation: "Baca" },
  { name: "get_shop_toggle_info", area: "Akun", operation: "Baca" },
  { name: "get_recommended_keyword_list", area: "Rekomendasi", operation: "Baca" },
  { name: "get_recommended_item_list", area: "Rekomendasi", operation: "Baca" },
  { name: "get_all_cpc_ads_hourly_performance", area: "Performa", operation: "Baca" },
  { name: "get_all_cpc_ads_daily_performance", area: "Performa", operation: "Baca" },
  { name: "create_auto_product_ads", area: "Iklan Produk", operation: "Aksi", offline: true },
  { name: "edit_auto_product_ads", area: "Iklan Produk", operation: "Aksi", offline: true },
  { name: "get_product_campaign_daily_performance", area: "Performa", operation: "Baca" },
  { name: "get_product_campaign_hourly_performance", area: "Performa", operation: "Baca" },
  { name: "get_product_level_campaign_id_list", area: "Iklan Produk", operation: "Baca" },
  { name: "get_product_level_campaign_setting_info", area: "Iklan Produk", operation: "Baca" },
  { name: "create_manual_product_ads", area: "Iklan Produk", operation: "Aksi" },
  { name: "edit_manual_product_ad_keywords", area: "Iklan Produk", operation: "Aksi" },
  { name: "edit_manual_product_ads", area: "Iklan Produk", operation: "Aksi" },
  { name: "get_create_product_ad_budget_suggestion", area: "Rekomendasi", operation: "Baca" },
  { name: "get_product_recommended_roi_target", area: "Rekomendasi", operation: "Baca" },
  { name: "get_ads_fácil_shop_rate", area: "Akun", operation: "Baca", unavailable: true },
  { name: "check_create_gms_product_campaign_eligibility", area: "GMV Max", operation: "Baca" },
  { name: "create_gms_product_campaign", area: "GMV Max", operation: "Aksi" },
  { name: "edit_gms_product_campaign", area: "GMV Max", operation: "Aksi" },
  { name: "list_gms_user_deleted_item", area: "GMV Max", operation: "Baca" },
  { name: "edit_gms_item_product_campaign", area: "GMV Max", operation: "Aksi" },
  { name: "get_gms_campaign_performance", area: "GMV Max", operation: "Baca" },
  { name: "get_gms_item_performance", area: "GMV Max", operation: "Baca" },
]

export function adsDocumentationUrl(name: string): string {
  return `https://open.shopee.com/documents/v2/v2.ads.${encodeURIComponent(name)}?module=117&type=1`
}
