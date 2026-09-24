// Defensive parser that turns the raw Shopee item-detail payload
// (get_item_base_info + get_model_list + get_item_extra_info + get_item_promotion)
// into a typed, UI-friendly shape. Every field is optional because the provider
// response can be partial.

function rec(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : undefined
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function path(root: unknown, keys: (string | number)[]): unknown {
  let current: unknown = root
  for (const key of keys) {
    const container = rec(current) ?? (Array.isArray(current) ? current : undefined)
    if (container === undefined) return undefined
    current = (container as Record<string | number, unknown>)[key]
  }
  return current
}

export type DetailModel = {
  id: string
  name: string
  sku?: string
  currentPrice?: number
  originalPrice?: number
  stock?: number
  hasPromotion: boolean
}

export type DetailTier = { name: string; options: string[] }
export type DetailAttribute = { name: string; value: string }
export type DetailPromotion = {
  type?: string
  id?: string
  start?: number
  end?: number
  status?: string
}

export type ProductDetail = {
  name?: string
  itemId?: string
  sku?: string
  categoryId?: string
  brand?: string
  condition?: string
  weightKg?: number
  dimension?: string
  preOrder?: string
  createTime?: number
  updateTime?: number
  description?: string
  images: string[]
  logistics: string[]
  attributes: DetailAttribute[]
  tiers: DetailTier[]
  models: DetailModel[]
  stats: { sale?: number; views?: number; likes?: number; rating?: number; comments?: number }
  priceMin?: number
  priceMax?: number
  originalMax?: number
  promotions: DetailPromotion[]
}

function isHttp(value: unknown): value is string {
  return typeof value === "string" && (value.startsWith("http://") || value.startsWith("https://"))
}

function imageList(base: unknown): string[] {
  const list = path(base, ["image", "image_url_list"])
  return arr(list).filter(isHttp)
}

function tierName(model: Record<string, unknown>, rawTiers: unknown): string {
  const explicit = str(model["model_name"])
  if (explicit !== undefined) return explicit
  const idx = arr(model["tier_index"])
  const parts: string[] = []
  idx.forEach((value, tierPosition) => {
    if (typeof value === "number") {
      const option = str(path(rawTiers, [tierPosition, "option_list", value, "option"]))
      if (option !== undefined) parts.push(option)
    }
  })
  return parts.length > 0 ? parts.join(" / ") : `Model ${str(model["model_id"]) ?? ""}`
}

export function parseProductDetail(raw: unknown): ProductDetail {
  const base = rec(path(raw, ["base_info", "response", "item_list", 0])) ?? {}
  const rawTiers = path(raw, ["model_list", "response", "tier_variation"])
  const rawModels = arr(path(raw, ["model_list", "response", "model"]))
  const extra = rec(path(raw, ["extra_info", "response", "item_list", 0])) ?? {}

  const tiers: DetailTier[] = arr(rawTiers).map((tier, index) => ({
    name: str((rec(tier) ?? {})["name"]) ?? `Tier ${index + 1}`,
    options: arr((rec(tier) ?? {})["option_list"])
      .map((option) => str((rec(option) ?? {})["option"]))
      .filter((option): option is string => option !== undefined),
  }))

  const models: DetailModel[] = rawModels.map((entry) => {
    const model = rec(entry) ?? {}
    const priceInfo = rec(arr(model["price_info"])[0]) ?? {}
    const stockV2 = num(path(model, ["stock_info_v2", "summary_info", "total_available_stock"]))
    return {
      id: String(model["model_id"] ?? ""),
      name: tierName(model, rawTiers),
      sku: str(model["model_sku"]),
      currentPrice: num(priceInfo["current_price"]),
      originalPrice: num(priceInfo["original_price"]),
      stock: stockV2 ?? num(model["stock"]),
      hasPromotion: model["has_promotion"] === true,
    }
  })

  const currents = models
    .map((model) => model.currentPrice)
    .filter((price): price is number => price !== undefined)
  const basePrice = rec(arr(base["price_info"])[0]) ?? {}
  if (currents.length === 0) {
    const single = num(basePrice["current_price"])
    if (single !== undefined) currents.push(single)
  }
  const originals = models
    .map((model) => model.originalPrice)
    .filter((price): price is number => price !== undefined)

  const dimension = rec(base["dimension"])
  const preOrder = rec(base["pre_order"])
  const attributes: DetailAttribute[] = arr(base["attribute_list"]).map((entry) => {
    const attribute = rec(entry) ?? {}
    const values = arr(attribute["attribute_value_list"])
      .map((value) => {
        const item = rec(value) ?? {}
        const name = str(item["original_value_name"]) ?? ""
        const unit = str(item["value_unit"])
        return unit ? `${name} ${unit}` : name
      })
      .filter((value) => value !== "")
    return {
      name: str(attribute["original_attribute_name"]) ?? `Atribut ${str(attribute["attribute_id"]) ?? ""}`,
      value: values.join(", ") || "—",
    }
  })

  const logistics = arr(base["logistic_info"])
    .filter((entry) => (rec(entry) ?? {})["enabled"] === true)
    .map((entry) => str((rec(entry) ?? {})["logistic_name"]))
    .filter((name): name is string => name !== undefined)

  const promotions: DetailPromotion[] = arr(path(raw, ["promotion", "response", "success_list"]))
    .flatMap((entry) => arr((rec(entry) ?? {})["promotion"]))
    .map((entry) => {
      const promotion = rec(entry) ?? {}
      return {
        type: str(promotion["promotion_type"]),
        id: str(String(promotion["promotion_id"] ?? "")),
        start: num(promotion["start_time"]),
        end: num(promotion["end_time"]),
        status: str(promotion["promotion_staging"]),
      }
    })

  return {
    name: str(base["item_name"]),
    itemId: str(String(base["item_id"] ?? "")),
    sku: str(base["item_sku"]),
    categoryId: str(String(base["category_id"] ?? "")),
    brand: str(path(base, ["brand", "original_brand_name"])),
    condition: str(base["condition"]),
    weightKg: num(base["weight"]),
    dimension:
      dimension === undefined
        ? undefined
        : `${dimension["package_length"] ?? "?"} × ${dimension["package_width"] ?? "?"} × ${dimension["package_height"] ?? "?"} cm`,
    preOrder:
      preOrder === undefined
        ? undefined
        : preOrder["is_pre_order"] === true
          ? `Ya, ${num(preOrder["days_to_ship"]) ?? "?"} hari`
          : "Tidak",
    createTime: num(base["create_time"]),
    updateTime: num(base["update_time"]),
    description: str(base["description"]),
    images: imageList(base),
    logistics,
    attributes,
    tiers,
    models,
    stats: {
      sale: num(extra["sale"]),
      views: num(extra["views"]),
      likes: num(extra["likes"]),
      rating: num(path(extra, ["rating_star"])),
      comments: num(extra["comment_count"]),
    },
    priceMin: currents.length > 0 ? Math.min(...currents) : undefined,
    priceMax: currents.length > 0 ? Math.max(...currents) : undefined,
    originalMax: originals.length > 0 ? Math.max(...originals) : undefined,
    promotions,
  }
}

export function rupiah(value: number | undefined): string {
  return typeof value === "number" ? `Rp ${new Intl.NumberFormat("id-ID").format(Math.round(value))}` : "—"
}

export function unixToDate(value: number | undefined): string {
  return typeof value === "number" && value > 0
    ? new Date(value * 1000).toLocaleString("id-ID")
    : "—"
}
