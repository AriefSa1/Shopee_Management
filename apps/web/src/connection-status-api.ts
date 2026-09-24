import type { PostgresExecutor, SqlRow } from "../../../packages/delivery/src/postgres-delivery.ts"
import { OrganizationIdSchema, ShopIdSchema } from "../../../packages/identity/src/model.ts"
import type { OAuthWebAuthContext } from "../../../packages/oauth/src/oauth-api.ts"

/**
 * Read-only connection observability for the web process.
 *
 * Reports, per shop connection, whether an official Shopee credential (the
 * encrypted refresh token) has been stored and is still usable. It only reads
 * status columns - never the ciphertext or any token - so it stays inside the
 * web runtime's capabilities and never touches the worker-only decryption path.
 */
export type ConnectionStatusApiDependencies = {
  readonly authenticate: (request: Request) => OAuthWebAuthContext | null
  readonly executor: PostgresExecutor
}

export type ShopConnectionState = "ready" | "awaiting_exchange" | "expired" | "reauth_required"

export type ShopConnectionStatus = {
  readonly shopId: string
  readonly externalShopId: string
  readonly market: string
  readonly connectionStatus: string
  readonly credentialStored: boolean
  readonly state: ShopConnectionState
  readonly credentialExpiresAt: string | null
}

export async function createConnectionStatusApiHandler(
  request: Request,
  dependencies: ConnectionStatusApiDependencies,
): Promise<Response> {
  const context = dependencies.authenticate(request)
  if (context === null)
    return Response.json({ error: { code: "authentication_required" } }, { status: 401 })

  const rows = await dependencies.executor.query({
    name: "web.connections.status",
    text: `SELECT
        sc.id,
        sc.external_shop_id,
        sc.market,
        sc.status AS connection_status,
        sc.created_at,
        EXISTS (
          SELECT 1
            FROM shop_credential_bindings scb
            JOIN credential_subjects cs
              ON cs.organization_id = scb.organization_id
             AND cs.credential_subject_id = scb.credential_subject_id
           WHERE scb.organization_id = sc.organization_id
             AND scb.shop_id = sc.id
             AND scb.status = 'active'
             AND cs.status = 'active'
             AND cs.expires_at > now()
        ) AS credential_ready,
        EXISTS (
          SELECT 1
            FROM shop_credential_bindings scb
            JOIN credential_subjects cs
              ON cs.organization_id = scb.organization_id
             AND cs.credential_subject_id = scb.credential_subject_id
           WHERE scb.organization_id = sc.organization_id
             AND scb.shop_id = sc.id
             AND scb.status = 'active'
             AND cs.status = 'active'
             AND cs.expires_at <= now()
        ) AS credential_expired,
        EXISTS (
          SELECT 1
            FROM shop_credential_bindings scb
           WHERE scb.organization_id = sc.organization_id
             AND scb.shop_id = sc.id
             AND scb.status = 'reauth_required'
        ) AS binding_reauth,
        (
          SELECT max(cs.expires_at)
            FROM shop_credential_bindings scb
            JOIN credential_subjects cs
              ON cs.organization_id = scb.organization_id
             AND cs.credential_subject_id = scb.credential_subject_id
           WHERE scb.organization_id = sc.organization_id
             AND scb.shop_id = sc.id
             AND scb.status = 'active'
             AND cs.status = 'active'
        ) AS credential_expires_at
      FROM shop_connections sc
      WHERE sc.organization_id = $1 AND sc.status = 'active'
      ORDER BY sc.created_at DESC`,
    params: [context.organizationId],
  })

  const connections = rows.map(mapConnection)
  return Response.json(
    {
      data: {
        organizationId: OrganizationIdSchema.parse(context.organizationId),
        connections,
        summary: {
          total: connections.length,
          ready: connections.filter((connection) => connection.state === "ready").length,
          awaitingExchange: connections.filter(
            (connection) => connection.state === "awaiting_exchange",
          ).length,
          expired: connections.filter((connection) => connection.state === "expired").length,
          reauthRequired: connections.filter((connection) => connection.state === "reauth_required")
            .length,
        },
      },
    },
    { headers: { "cache-control": "no-store" } },
  )
}

function mapConnection(row: SqlRow): ShopConnectionStatus {
  const credentialReady = booleanValue(row["credential_ready"])
  const credentialExpired = booleanValue(row["credential_expired"])
  const bindingReauth = booleanValue(row["binding_reauth"])
  const state: ShopConnectionState = credentialReady
    ? "ready"
    : credentialExpired
      ? "expired"
      : bindingReauth
        ? "reauth_required"
        : "awaiting_exchange"
  return {
    shopId: ShopIdSchema.parse(requiredString(row, "id")),
    externalShopId: requiredString(row, "external_shop_id"),
    market: requiredString(row, "market"),
    connectionStatus: requiredString(row, "connection_status"),
    credentialStored: credentialReady,
    state,
    credentialExpiresAt: optionalString(row, "credential_expires_at"),
  }
}

function requiredString(row: SqlRow, key: string): string {
  const value = row[key]
  if (typeof value !== "string") throw new Error(`Invalid connection row field: ${key}`)
  return value
}

function optionalString(row: SqlRow, key: string): string | null {
  const value = row[key]
  if (value === null || value === undefined) return null
  if (typeof value !== "string") throw new Error(`Invalid connection row field: ${key}`)
  return value
}

function booleanValue(value: unknown): boolean {
  if (typeof value === "boolean") return value
  // Defensive: some drivers surface a boolean projection as 't'/'f' or 0/1.
  if (value === "t" || value === "true" || value === 1) return true
  if (value === "f" || value === "false" || value === 0) return false
  throw new Error("Invalid connection boolean projection")
}
