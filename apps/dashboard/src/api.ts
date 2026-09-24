// Typed client for the web process JSON endpoints. All requests are same-origin
// and rely on the internal operator session cookie set by POST /api/session/login.

export type Store = {
  id: string
  externalShopId: string
  market: string
  status: string
  createdAt: string
  shopName?: string
}

export type ConnectionState = "ready" | "awaiting_exchange" | "expired" | "reauth_required"

export type Connection = {
  shopId: string
  externalShopId: string
  market: string
  connectionStatus: string
  credentialStored: boolean
  state: ConnectionState
  credentialExpiresAt: string | null
}

export type ConnectionsSummary = {
  total: number
  ready: number
  awaitingExchange: number
  expired: number
  reauthRequired: number
}

export type Publication = "active" | "inactive" | "unknown"

export type ProductStats = {
  sale?: number
  views?: number
  likes?: number
  rating_star?: number
  comment_count?: number
}

export type Product = {
  productId: number | string
  name?: string
  publication?: Publication
  stats?: ProductStats
  raw?: unknown
}

export type Catalog = {
  shopId: string
  collectedAt: string
  completeness: { kind: string }
  products: Product[]
}

export class ApiError extends Error {
  readonly code: string
  readonly status: number
  constructor(code: string, status: number) {
    super(code)
    this.code = code
    this.status = status
  }
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: { accept: "application/json" },
  })
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const code = errorCode(body) ?? `http_${response.status}`
    throw new ApiError(code, response.status)
  }
  return body as T
}

function errorCode(body: unknown): string | undefined {
  if (body !== null && typeof body === "object" && "error" in body) {
    const error = (body as { error?: unknown }).error
    if (error !== null && typeof error === "object") {
      const record = error as Record<string, unknown>
      const value = record["providerCode"] ?? record["code"]
      if (typeof value === "string") return value
    }
  }
  return undefined
}

export const api = {
  async sessionStatus(): Promise<boolean> {
    try {
      const body = await getJson<{ authenticated?: boolean }>("/api/session/status")
      return body.authenticated === true
    } catch {
      return false
    }
  },

  async login(loginToken: string): Promise<void> {
    const response = await fetch("/api/session/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ loginToken }),
    })
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null)
      throw new ApiError(errorCode(body) ?? `http_${response.status}`, response.status)
    }
  },

  async logout(): Promise<void> {
    await fetch("/api/session/logout", { method: "POST", credentials: "same-origin" }).catch(
      () => undefined,
    )
  },

  async stores(): Promise<Store[]> {
    const body = await getJson<{ data?: { stores?: Store[] } }>("/api/stores")
    return body.data?.stores ?? []
  },

  async connections(): Promise<{ connections: Connection[]; summary: ConnectionsSummary }> {
    const body = await getJson<{
      data?: { connections?: Connection[]; summary?: ConnectionsSummary }
    }>("/api/connections")
    return {
      connections: body.data?.connections ?? [],
      summary:
        body.data?.summary ??
        { total: 0, ready: 0, awaitingExchange: 0, expired: 0, reauthRequired: 0 },
    }
  },

  async catalog(shopId: string): Promise<Catalog> {
    const body = await getJson<{ data: Catalog }>(
      `/api/catalog?shopId=${encodeURIComponent(shopId)}`,
    )
    return body.data
  },

  async productDetail(shopId: string, itemId: number | string): Promise<unknown> {
    const body = await getJson<{ data?: { raw?: unknown } }>(
      `/api/catalog/item?shopId=${encodeURIComponent(shopId)}&itemId=${encodeURIComponent(String(itemId))}`,
    )
    return body.data?.raw ?? {}
  },

  async hotListing(shopId: string, period: HotListingPeriod): Promise<HotListing> {
    const body = await getJson<{ data: HotListing }>(
      `/api/insights/hot-listing?shopId=${encodeURIComponent(shopId)}&period=${encodeURIComponent(period)}`,
    )
    return body.data
  },
}

export type HotListingPeriod = "real_time" | "yesterday" | "past7days" | "past30days"

export type HotListingMetrics = {
  sales?: number
  buyers?: number
  orders?: number
  units?: number
  conversionRate?: number
  productImpression?: number
  productClicks?: number
  clickThroughRate?: number
  salesPctDiff?: number
  ordersPctDiff?: number
  unitsPctDiff?: number
  conversionRatePctDiff?: number
}

export type HotListingTimePoint = {
  t?: number
  sales?: number
  orders?: number
  units?: number
}

export type HotListingProduct = {
  itemId?: number
  itemName?: string
  image?: string
  variationName?: string
  sales?: number
  units?: number
  orders?: number
  productImpression?: number
}

export type HotListingOrderType = {
  orderType?: string
  metrics: HotListingMetrics
  timeSeries: HotListingTimePoint[]
  performance: HotListingProduct[]
}

export type HotListing = {
  shopId: string
  period: HotListingPeriod
  orderTypes: HotListingOrderType[]
}

// Prefer paid sales, then placed, then whatever the shop country returns.
export function pickOrderType(list: HotListingOrderType[]): HotListingOrderType | undefined {
  return (
    list.find((entry) => entry.orderType === "paid") ??
    list.find((entry) => entry.orderType === "placed") ??
    list[0]
  )
}

export function storeLabel(store: Store): string {
  return store.shopName && store.shopName.trim().length > 0
    ? store.shopName
    : `Toko ${store.externalShopId}`
}

const connectionStateMeta: Record<ConnectionState, { label: string; color: string }> = {
  ready: { label: "Token siap", color: "green" },
  awaiting_exchange: { label: "Menunggu proses", color: "yellow" },
  expired: { label: "Token kedaluwarsa", color: "orange" },
  reauth_required: { label: "Perlu otorisasi ulang", color: "red" },
}

export function connectionStateMetaOf(state: ConnectionState) {
  return connectionStateMeta[state]
}
