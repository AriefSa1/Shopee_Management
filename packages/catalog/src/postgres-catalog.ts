import { z } from "zod"
import {
  CatalogProductFixtureSchema,
  OrganizationIdSchema,
  ShopIdSchema,
  type CatalogProduct,
} from "./catalog.ts"
import type { CatalogCollection } from "./catalog.ts"
import type { OrganizationId, ShopId } from "../../identity/src/model.ts"
import type { PostgresExecutor, SqlRow } from "../../delivery/src/postgres-delivery.ts"

export const CatalogCollectionRunIdSchema = z.string().uuid().brand("CatalogCollectionRunId")
export type CatalogCollectionRunId = z.infer<typeof CatalogCollectionRunIdSchema>

export type CatalogCollectionScope = {
  readonly organizationId: OrganizationId
  readonly shopId: ShopId
}

export type CatalogCollectionRecord = {
  readonly collectionRunId: CatalogCollectionRunId
  readonly collection: CatalogCollection
}

export class CatalogPersistenceError extends Error {
  readonly name = "CatalogPersistenceError"
  readonly code: "organization_mismatch" | "shop_mismatch" | "duplicate_run" | "invalid_row"

  constructor(code: "organization_mismatch" | "shop_mismatch" | "duplicate_run" | "invalid_row") {
    super(`Catalog persistence rejected the request: ${code}`)
    this.code = code
  }
}

export class PostgresCatalogRepository {
  private readonly executor: PostgresExecutor

  constructor(executor: PostgresExecutor) {
    this.executor = executor
  }

  saveCollection(input: CatalogCollectionRecord): Promise<void> {
    return this.executor.transaction(async (tx) => {
      const collectionRunId = CatalogCollectionRunIdSchema.parse(input.collectionRunId)
      const collection = input.collection
      const completeness = collection.completeness.kind
      const incompleteReason = completeness === "incomplete" ? collection.completeness.reason : null
      await tx.query({
        name: "catalog.collection_run.insert",
        text: `INSERT INTO catalog_collection_runs (
          collection_run_id, organization_id, shop_id, collected_at, completeness, incomplete_reason
        ) VALUES ($1, $2, $3, $4, $5, $6)`,
        params: [collectionRunId, collection.organizationId, collection.shopId, collection.collectedAt, completeness, incompleteReason],
      })
      for (const product of collection.products) {
        const parsed = CatalogProductFixtureSchema.parse(product)
        await tx.query({
          name: "catalog.product.insert",
          text: `INSERT INTO catalog_products (
            collection_run_id, organization_id, shop_id, product_id, product_name, publication, available_stock
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          params: [collectionRunId, collection.organizationId, collection.shopId, parsed.productId, parsed.name, parsed.publication, parsed.availableStock ?? null],
        })
        for (const variant of parsed.variants) {
          await tx.query({
            name: "catalog.variant.insert",
            text: `INSERT INTO catalog_variants (
              collection_run_id, product_id, organization_id, shop_id, variant_id, variant_name, available_stock
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            params: [collectionRunId, parsed.productId, collection.organizationId, collection.shopId, variant.variantId, variant.name, variant.availableStock ?? null],
          })
        }
      }
    })
  }

  async readCollection(scope: CatalogCollectionScope, collectionRunId: CatalogCollectionRunId): Promise<CatalogCollection | null> {
    const runId = CatalogCollectionRunIdSchema.parse(collectionRunId)
    const rows = await this.executor.query({
      name: "catalog.collection.read",
      text: `SELECT r.collection_run_id, r.organization_id, r.shop_id, r.collected_at,
        r.completeness, r.incomplete_reason,
        p.product_id, p.product_name, p.publication, p.available_stock,
        v.variant_id, v.variant_name, v.available_stock AS variant_available_stock
      FROM catalog_collection_runs AS r
      LEFT JOIN catalog_products AS p
        ON p.collection_run_id = r.collection_run_id
      LEFT JOIN catalog_variants AS v
        ON v.collection_run_id = p.collection_run_id AND v.product_id = p.product_id
      WHERE r.organization_id = $1 AND r.shop_id = $2 AND r.collection_run_id = $3
      ORDER BY p.product_id, v.variant_id`,
      params: [scope.organizationId, scope.shopId, runId],
    })
    if (rows.length === 0) return null
    return mapCollection(rows)
  }
}

function mapCollection(rows: readonly SqlRow[]): CatalogCollection {
  const first = rows[0]
  if (first === undefined) throw new CatalogPersistenceError("invalid_row")
  const organizationId = OrganizationIdSchema.parse(requiredString(first, "organization_id"))
  const shopId = ShopIdSchema.parse(requiredString(first, "shop_id"))
  const completenessValue = requiredString(first, "completeness")
  const incompleteReason = first["incomplete_reason"]
  const completeness = completenessValue === "complete"
    ? { kind: "complete" as const }
    : { kind: "incomplete" as const, reason: z.enum(["missing_next_cursor", "cursor_repeated", "duplicate_product", "malformed_page"]).parse(incompleteReason) }
  const products = new Map<string, CatalogProduct>()
  for (const row of rows) {
    const rawProductId = row["product_id"]
    if (rawProductId === null || rawProductId === undefined) continue
    const productId = requiredString(row, "product_id")
    const existing = products.get(productId)
    const variantId = row["variant_id"]
    const variants = existing?.variants ?? []
    const nextVariants = typeof variantId === "string"
      ? [...variants, { variantId, name: requiredString(row, "variant_name"), ...(nullableNumber(row, "variant_available_stock") === null ? {} : { availableStock: nullableNumber(row, "variant_available_stock") ?? undefined }) }]
      : variants
    products.set(productId, CatalogProductFixtureSchema.parse({
      productId,
      name: requiredString(row, "product_name"),
      publication: requiredString(row, "publication"),
      ...(nullableNumber(row, "available_stock") === null ? {} : { availableStock: nullableNumber(row, "available_stock") ?? undefined }),
      variants: nextVariants,
    }))
  }
  return {
    organizationId,
    shopId,
    collectedAt: requiredString(first, "collected_at"),
    products: [...products.values()],
    completeness,
  }
}

function requiredString(row: SqlRow, key: string): string {
  const value = row[key]
  if (typeof value !== "string") throw new CatalogPersistenceError("invalid_row")
  return value
}

function nullableNumber(row: SqlRow, key: string): number | null {
  const value = row[key]
  if (value === null || value === undefined) return null
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new CatalogPersistenceError("invalid_row")
  return value
}
