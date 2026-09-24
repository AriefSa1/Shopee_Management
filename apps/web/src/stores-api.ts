import { OrganizationIdSchema, ShopIdSchema } from "../../../packages/identity/src/model.ts"
import type { PostgresExecutor, SqlRow } from "../../../packages/delivery/src/postgres-delivery.ts"
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
  const rows = await dependencies.executor.query({
    name: "web.shop_connections.list_active",
    text: `SELECT id, external_shop_id, market, status, created_at
      FROM shop_connections
      WHERE organization_id = $1 AND status = 'active'
      ORDER BY created_at DESC`,
    params: [context.organizationId],
  })
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
  return {
    id: ShopIdSchema.parse(requiredString(row, "id")),
    externalShopId: requiredString(row, "external_shop_id"),
    market: requiredString(row, "market"),
    status: requiredString(row, "status"),
    createdAt: requiredString(row, "created_at"),
  }
}

function requiredString(row: SqlRow, key: string): string {
  const value = row[key]
  if (typeof value !== "string") throw new Error(`Invalid store row field: ${key}`)
  return value
}
