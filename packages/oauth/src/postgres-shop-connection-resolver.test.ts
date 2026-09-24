import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { PostgresExecutor, SqlRow, SqlStatement } from "../../delivery/src/postgres-delivery.ts"
import { OrganizationIdSchema, ShopIdSchema } from "../../identity/src/model.ts"
import {
  CallbackCodeSchema,
  OAuthAttemptIdSchema,
  OAuthStateHashSchema,
  PartnerApplicationIdSchema,
  ShopeeShopIdSchema,
} from "./model.ts"
import {
  OAuthShopConnectionResolutionError,
  PostgresOAuthShopConnectionResolver,
} from "./postgres-shop-connection-resolver.ts"

const organizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
const partnerApplicationId = PartnerApplicationIdSchema.parse("20000000-0000-4000-8000-000000000001")
const internalShopId = ShopIdSchema.parse("30000000-0000-4000-8000-000000000001")

function claim() {
  return {
    attemptId: OAuthAttemptIdSchema.parse("40000000-0000-4000-8000-000000000001"),
    organizationId,
    actor: { issuer: "https://id.example.test", subject: "owner-a" },
    partnerApplicationId,
    market: "ID" as const,
    stateHash: OAuthStateHashSchema.parse("state-connection-000000000000000000000000000001"),
    issuedAt: "2026-09-15T00:00:00.000Z",
    expiresAt: "2026-09-15T00:10:00.000Z",
    shopId: ShopeeShopIdSchema.parse("1819834906"),
    callbackCode: CallbackCodeSchema.parse("callback-code-fixture"),
  }
}

class ConnectionResolverExecutor implements PostgresExecutor {
  readonly statements: SqlStatement[] = []
  private readonly rows: readonly SqlRow[]

  constructor(rows: readonly SqlRow[]) {
    this.rows = rows
  }

  async query(statement: SqlStatement): Promise<readonly SqlRow[]> {
    this.statements.push(statement)
    return this.rows
  }

  transaction<T>(work: (executor: PostgresExecutor) => Promise<T>): Promise<T> {
    return work(this)
  }
}

describe("PostgreSQL OAuth shop connection resolver", () => {
  it("resolves only an active connection scoped to the claim organization, application, market, and Shopee shop", async () => {
    // Given: one active internal shop connection for the exact OAuth callback scope.
    const executor = new ConnectionResolverExecutor([{
      organization_id: organizationId,
      shop_id: internalShopId,
      partner_application_id: partnerApplicationId,
      market: "ID",
      external_shop_id: "1819834906",
    }])
    const resolver = new PostgresOAuthShopConnectionResolver(executor)

    // When: the worker resolves the callback claim before credential persistence.
    const connection = await resolver.resolve(claim())

    // Then: the internal shop identity is returned from a fully scoped SQL read.
    assert.deepEqual(connection, {
      organizationId,
      shopId: internalShopId,
      partnerApplicationId,
      market: "ID",
      externalShopId: "1819834906",
    })
    assert.deepEqual(executor.statements[0]?.params, [organizationId, partnerApplicationId, "ID", "1819834906"])
    assert.match(executor.statements[0]?.text ?? "", /status = 'active'/)
  })

  it("returns no connection when the scoped active shop is absent", async () => {
    // Given: a database read with no active connection matching the callback claim.
    const resolver = new PostgresOAuthShopConnectionResolver(new ConnectionResolverExecutor([]))

    // When: the worker resolves the claimed external Shopee shop.
    const connection = await resolver.resolve(claim())

    // Then: credential persistence remains blocked by an absent mapping.
    assert.equal(connection, undefined)
  })

  it("rejects a malformed row instead of trusting an untyped internal shop id", async () => {
    // Given: a SQL row whose internal shop identity is not a UUID.
    const resolver = new PostgresOAuthShopConnectionResolver(new ConnectionResolverExecutor([{
      organization_id: organizationId,
      shop_id: "not-a-uuid",
      partner_application_id: partnerApplicationId,
      market: "ID",
      external_shop_id: "1819834906",
    }]))

    // When: the worker maps the database result into the typed OAuth boundary.
    const result = resolver.resolve(claim())

    // Then: malformed persistence data fails closed before a credential can be bound.
    await assert.rejects(result, OAuthShopConnectionResolutionError)
  })
})
