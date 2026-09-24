import { z } from "zod"
import type { PostgresExecutor, SqlRow } from "../../delivery/src/postgres-delivery.ts"
import { OrganizationIdSchema, ShopIdSchema } from "../../identity/src/model.ts"
import {
  OAuthMarketSchema,
  PartnerApplicationIdSchema,
  ShopeeShopIdSchema,
} from "./model.ts"
import type { OAuthCallbackClaim } from "./model.ts"

const OAuthShopConnectionSchema = z.object({
  organizationId: OrganizationIdSchema,
  shopId: ShopIdSchema,
  partnerApplicationId: PartnerApplicationIdSchema,
  market: OAuthMarketSchema,
  externalShopId: ShopeeShopIdSchema,
}).strict().readonly()

export type OAuthShopConnection = z.infer<typeof OAuthShopConnectionSchema>

export class OAuthShopConnectionResolutionError extends Error {
  readonly name = "OAuthShopConnectionResolutionError"
  readonly reason: "invalid_row" | "scope_mismatch"

  constructor(reason: OAuthShopConnectionResolutionError["reason"]) {
    super("OAuth shop connection resolution failed")
    this.reason = reason
  }
}

export class PostgresOAuthShopConnectionResolver {
  private readonly executor: PostgresExecutor

  constructor(executor: PostgresExecutor) {
    this.executor = executor
  }

  async resolve(claim: OAuthCallbackClaim): Promise<OAuthShopConnection | undefined> {
    const rows = await this.executor.query({
      name: "oauth.shop_connection.resolve_active",
      text: `SELECT organization_id, id AS shop_id, partner_application_id::text AS partner_application_id,
        market, external_shop_id
        FROM shop_connections
        WHERE organization_id = $1 AND partner_application_id::text = $2
          AND market = $3 AND external_shop_id = $4 AND status = 'active'
        LIMIT 1`,
      params: [claim.organizationId, claim.partnerApplicationId, claim.market, claim.shopId],
    })
    const row = rows[0]
    if (row === undefined) return undefined
    const connection = mapConnection(row)
    if (!matchesClaim(connection, claim)) {
      throw new OAuthShopConnectionResolutionError("scope_mismatch")
    }
    return connection
  }
}

function mapConnection(row: SqlRow): OAuthShopConnection {
  try {
    return OAuthShopConnectionSchema.parse({
      organizationId: requiredString(row, "organization_id"),
      shopId: requiredString(row, "shop_id"),
      partnerApplicationId: requiredString(row, "partner_application_id"),
      market: requiredString(row, "market"),
      externalShopId: requiredString(row, "external_shop_id"),
    })
  } catch (error) {
    if (error instanceof OAuthShopConnectionResolutionError) throw error
    throw new OAuthShopConnectionResolutionError("invalid_row")
  }
}

function matchesClaim(connection: OAuthShopConnection, claim: OAuthCallbackClaim): boolean {
  return connection.organizationId === claim.organizationId
    && connection.partnerApplicationId === claim.partnerApplicationId
    && connection.market === claim.market
    && connection.externalShopId === claim.shopId
}

function requiredString(row: SqlRow, key: string): string {
  const value = row[key]
  if (typeof value !== "string") throw new OAuthShopConnectionResolutionError("invalid_row")
  return value
}
