import { z } from "zod"
import {
  type OrganizationId,
  OrganizationIdSchema,
  type ShopId,
  ShopIdSchema,
} from "../../identity/src/model.ts"

export { OrganizationIdSchema, ShopIdSchema }

export const CatalogCursorSchema = z.string().trim().min(1).max(1024).brand("CatalogCursor")
export const CatalogProductIdSchema = z.string().trim().min(1).max(255).brand("CatalogProductId")
export const CatalogVariantIdSchema = z.string().trim().min(1).max(255).brand("CatalogVariantId")
export const CatalogCapabilitySchema = z.enum(["enabled", "unsupported"])

export type CatalogCursor = z.infer<typeof CatalogCursorSchema>
export type CatalogProductId = z.infer<typeof CatalogProductIdSchema>
export type CatalogVariantId = z.infer<typeof CatalogVariantIdSchema>
export type CatalogCapability = z.infer<typeof CatalogCapabilitySchema>

export const CatalogVariantFixtureSchema = z
  .object({
    variantId: CatalogVariantIdSchema,
    name: z.string().trim().min(1).max(255),
    availableStock: z.number().int().nonnegative().optional(),
  })
  .strict()
  .readonly()

export const CatalogProductFixtureSchema = z
  .object({
    productId: CatalogProductIdSchema,
    name: z.string().trim().min(1).max(255),
    publication: z.enum(["active", "inactive", "unknown"]),
    availableStock: z.number().int().nonnegative().optional(),
    variants: z.array(CatalogVariantFixtureSchema).readonly(),
    // Full untouched provider payload for the product, surfaced so operators can
    // inspect every field the Shopee response returned without exception.
    raw: z.unknown().optional(),
    // Best-effort engagement stats (get_item_extra_info): sales, views, likes,
    // rating and comment count, batched into the list for marketplace-style cards.
    stats: z.unknown().optional(),
  })
  .strict()
  .readonly()

export const CatalogPageSchema = z
  .object({
    products: z.array(CatalogProductFixtureSchema).readonly(),
    hasNextPage: z.boolean(),
    nextCursor: CatalogCursorSchema.optional(),
  })
  .strict()
  .readonly()

export const CatalogFilterSchema = z
  .object({
    query: z.string().trim().min(1).max(255).optional(),
    publication: z.enum(["active", "inactive", "unknown"]).optional(),
    stock: z.enum(["in_stock", "out_of_stock", "not_returned"]).optional(),
    freshness: z
      .object({
        now: z.string().datetime({ offset: true }),
        maximumAgeMinutes: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .readonly()

export type CatalogProduct = z.infer<typeof CatalogProductFixtureSchema>
export type CatalogPage = z.infer<typeof CatalogPageSchema>
export type CatalogFilter = z.infer<typeof CatalogFilterSchema>

export type CatalogReadContext = {
  readonly organizationId: OrganizationId
  readonly accessibleShopIds: readonly ShopId[]
  readonly capability: CatalogCapability
}

export type CatalogPageRequest = {
  readonly shopId: ShopId
  readonly cursor?: CatalogCursor
}

export interface OfficialCatalogReadAdapter {
  readonly capability: CatalogCapability
  fetchPage(request: CatalogPageRequest): Promise<unknown>
}

export type CatalogAccessDecision =
  | { readonly kind: "allowed"; readonly request: CatalogPageRequest }
  | {
      readonly kind: "denied"
      readonly reason: "organization_mismatch" | "shop_not_accessible" | "capability_unavailable"
    }

export type CatalogCompleteness =
  | { readonly kind: "complete" }
  | {
      readonly kind: "incomplete"
      readonly reason:
        | "missing_next_cursor"
        | "cursor_repeated"
        | "duplicate_product"
        | "malformed_page"
    }

export type CatalogCollection = {
  readonly organizationId: OrganizationId
  readonly shopId: ShopId
  readonly collectedAt: string
  readonly products: readonly CatalogProduct[]
  readonly completeness: CatalogCompleteness
}

export type CatalogCollectionResult =
  | { readonly kind: "collected"; readonly collection: CatalogCollection }
  | {
      readonly kind: "denied"
      readonly reason:
        | "malformed_cursor"
        | "organization_mismatch"
        | "shop_not_accessible"
        | "capability_unavailable"
    }

export type CatalogProviderFailure = {
  readonly kind: "adapter_failure"
  readonly upstreamDetail: string
}

export type SafeCatalogError = {
  readonly code: "catalog_provider_unavailable"
  readonly retryable: true
}

export function requestCatalogSync(input: {
  readonly context: CatalogReadContext
  readonly requestedOrganizationId: OrganizationId
  readonly shopId: ShopId
  readonly adapter: OfficialCatalogReadAdapter
}): CatalogAccessDecision {
  if (input.context.organizationId !== input.requestedOrganizationId) {
    return { kind: "denied", reason: "organization_mismatch" }
  }
  if (!input.context.accessibleShopIds.some((shopId) => shopId === input.shopId)) {
    return { kind: "denied", reason: "shop_not_accessible" }
  }
  if (input.context.capability !== "enabled" || input.adapter.capability !== "enabled") {
    return { kind: "denied", reason: "capability_unavailable" }
  }
  return { kind: "allowed", request: { shopId: input.shopId } }
}

export async function collectCatalogPages(input: {
  readonly context: CatalogReadContext
  readonly shopId: ShopId
  readonly adapter: OfficialCatalogReadAdapter
  readonly collectedAt: string
  readonly initialCursor?: unknown
}): Promise<CatalogCollectionResult> {
  const access = requestCatalogSync({
    context: input.context,
    requestedOrganizationId: input.context.organizationId,
    shopId: input.shopId,
    adapter: input.adapter,
  })
  if (access.kind === "denied") return access

  const initialCursor = parseInitialCursor(input.initialCursor)
  if (initialCursor.kind === "denied") return initialCursor

  const products = new Map<CatalogProductId, CatalogProduct>()
  const requestedCursors = new Set<string>()
  let cursor = initialCursor.cursor
  let completeness: CatalogCompleteness = { kind: "complete" }

  while (true) {
    const cursorKey = cursor === undefined ? "first_page" : cursor
    if (requestedCursors.has(cursorKey)) {
      completeness = { kind: "incomplete", reason: "cursor_repeated" }
      break
    }
    requestedCursors.add(cursorKey)

    const pageResult = CatalogPageSchema.safeParse(
      await input.adapter.fetchPage({
        shopId: input.shopId,
        ...(cursor === undefined ? {} : { cursor }),
      }),
    )
    if (!pageResult.success) {
      completeness = { kind: "incomplete", reason: "malformed_page" }
      break
    }

    for (const product of pageResult.data.products) {
      if (products.has(product.productId)) {
        completeness = { kind: "incomplete", reason: "duplicate_product" }
        continue
      }
      products.set(product.productId, product)
    }

    if (!pageResult.data.hasNextPage) break
    if (pageResult.data.nextCursor === undefined) {
      completeness = { kind: "incomplete", reason: "missing_next_cursor" }
      break
    }
    cursor = pageResult.data.nextCursor
  }

  return {
    kind: "collected",
    collection: {
      organizationId: input.context.organizationId,
      shopId: input.shopId,
      collectedAt: parseCollectionTimestamp(input.collectedAt),
      products: [...products.values()].sort((left, right) =>
        left.productId.localeCompare(right.productId),
      ),
      completeness,
    },
  }
}

export function filterCatalog(
  collection: CatalogCollection,
  rawFilter: unknown,
): readonly CatalogProduct[] {
  const filter = CatalogFilterSchema.parse(rawFilter)
  if (filter.freshness !== undefined && !isCatalogFresh(collection, filter.freshness)) return []

  return collection.products.filter((product) => matchesCatalogFilter(product, filter))
}

export function toSafeCatalogError(_failure: CatalogProviderFailure): SafeCatalogError {
  return { code: "catalog_provider_unavailable", retryable: true }
}

function parseInitialCursor(
  value: unknown,
):
  | { readonly kind: "parsed"; readonly cursor?: CatalogCursor }
  | { readonly kind: "denied"; readonly reason: "malformed_cursor" } {
  if (value === undefined) return { kind: "parsed" }
  const parsed = CatalogCursorSchema.safeParse(value)
  return parsed.success
    ? { kind: "parsed", cursor: parsed.data }
    : { kind: "denied", reason: "malformed_cursor" }
}

function parseCollectionTimestamp(value: string): string {
  return z.string().datetime({ offset: true }).parse(value)
}

function isCatalogFresh(
  collection: CatalogCollection,
  freshness: NonNullable<CatalogFilter["freshness"]>,
): boolean {
  const collectedAt = Date.parse(collection.collectedAt)
  const now = Date.parse(freshness.now)
  return now - collectedAt <= freshness.maximumAgeMinutes * 60_000
}

function matchesCatalogFilter(product: CatalogProduct, filter: CatalogFilter): boolean {
  if (
    filter.query !== undefined &&
    !product.name.toLocaleLowerCase().includes(filter.query.toLocaleLowerCase())
  ) {
    return false
  }
  if (filter.publication !== undefined && product.publication !== filter.publication) return false
  return matchesStockFilter(product.availableStock, filter.stock)
}

function matchesStockFilter(
  availableStock: number | undefined,
  stock: CatalogFilter["stock"],
): boolean {
  switch (stock) {
    case undefined:
      return true
    case "in_stock":
      return availableStock !== undefined && availableStock > 0
    case "out_of_stock":
      return availableStock === 0
    case "not_returned":
      return availableStock === undefined
    default:
      return assertNever(stock)
  }
}

function assertNever(value: never): never {
  throw new CatalogContractError("unexpected_catalog_variant", String(value))
}

class CatalogContractError extends Error {
  readonly name = "CatalogContractError"
  readonly code: "unexpected_catalog_variant"

  constructor(code: "unexpected_catalog_variant", detail: string) {
    super(`Catalog contract received an unsupported variant: ${detail}`)
    this.code = code
  }
}
