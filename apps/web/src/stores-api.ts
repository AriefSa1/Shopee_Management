import type { PostgresExecutor, SqlRow } from "../../../packages/delivery/src/postgres-delivery.ts"
import { OrganizationIdSchema, ShopIdSchema } from "../../../packages/identity/src/model.ts"
import type { OAuthWebAuthContext } from "../../../packages/oauth/src/oauth-api.ts"

export type StoreApiDependencies = {
  readonly authenticate: (request: Request) => OAuthWebAuthContext | null
  readonly executor: PostgresExecutor
}

export async function createStoresApiHandler(
  request: Request,
  dependencies: StoreApiDependencies,
): Promise<Response> {
  const context = dependencies.authenticate(request)
  if (context === null)
    return Response.json({ error: { code: "authentication_required" } }, { status: 401 })
  // Prefer the shop_name column; fall back gracefully when the 0016 migration
  // has not been applied yet, so a deploy that lands before the migration keeps
  // /api/stores working (names simply appear once the column exists).
  let rows: readonly SqlRow[]
  try {
    rows = await dependencies.executor.query({
      name: "web.shop_connections.list_active",
      text: `SELECT id, external_shop_id, market, status, shop_name, created_at
        FROM shop_connections
        WHERE organization_id = $1 AND status = 'active'
        ORDER BY created_at DESC`,
      params: [context.organizationId],
    })
  } catch (error) {
    if (!isUndefinedColumnError(error)) throw error
    rows = await dependencies.executor.query({
      name: "web.shop_connections.list_active_legacy",
      text: `SELECT id, external_shop_id, market, status, created_at
        FROM shop_connections
        WHERE organization_id = $1 AND status = 'active'
        ORDER BY created_at DESC`,
      params: [context.organizationId],
    })
  }
  return Response.json(
    {
      data: {
        organizationId: OrganizationIdSchema.parse(context.organizationId),
        stores: rows.map(mapStore),
      },
    },
    { headers: { "cache-control": "no-store" } },
  )
}

function mapStore(row: SqlRow) {
  const shopName = optionalString(row, "shop_name")
  return {
    id: ShopIdSchema.parse(requiredString(row, "id")),
    externalShopId: requiredString(row, "external_shop_id"),
    market: requiredString(row, "market"),
    status: requiredString(row, "status"),
    createdAt: requiredString(row, "created_at"),
    ...(shopName === undefined ? {} : { shopName }),
  }
}

function isUndefinedColumnError(error: unknown): boolean {
  // PostgreSQL SQLSTATE 42703 = undefined_column.
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "42703"
  )
}

function requiredString(row: SqlRow, key: string): string {
  const value = row[key]
  if (typeof value !== "string") throw new Error(`Invalid store row field: ${key}`)
  return value
}

function optionalString(row: SqlRow, key: string): string | undefined {
  const value = row[key]
  if (value === null || value === undefined) return undefined
  if (typeof value !== "string") throw new Error(`Invalid store row field: ${key}`)
  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed
}
