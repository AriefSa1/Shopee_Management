import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { PostgresExecutor, SqlRow, SqlStatement } from "../../delivery/src/postgres-delivery.ts"
import { OrganizationIdSchema, ShopIdSchema } from "../../identity/src/model.ts"
import type { KmsEnvelopeCodec } from "./durable-contracts.ts"
import {
  CallbackCodeSchema,
  OAuthAttemptIdSchema,
  OAuthStateHashSchema,
  PartnerApplicationIdSchema,
  ShopeeShopIdSchema,
} from "./model.ts"
import {
  PostgresOAuthExchangeCommitter,
  ShopeeOAuthExchangeCommitError,
} from "./postgres-oauth-exchange-committer.ts"

const organizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
const partnerApplicationId = PartnerApplicationIdSchema.parse("20000000-0000-4000-8000-000000000001")
const internalShopId = ShopIdSchema.parse("30000000-0000-4000-8000-000000000001")
const subjectId = "40000000-0000-4000-8000-000000000001"
const grantId = "50000000-0000-4000-8000-000000000001"

function claim() {
  return {
    attemptId: OAuthAttemptIdSchema.parse("60000000-0000-4000-8000-000000000001"),
    organizationId,
    actor: { issuer: "https://id.example.test", subject: "owner-a" },
    partnerApplicationId,
    market: "ID" as const,
    stateHash: OAuthStateHashSchema.parse("state-committer-00000000000000000000000000001"),
    issuedAt: "2026-09-16T00:00:00.000Z",
    expiresAt: "2026-09-16T00:10:00.000Z",
    shopId: ShopeeShopIdSchema.parse("1819834906"),
    callbackCode: CallbackCodeSchema.parse("callback-code-fixture"),
  }
}

class CommitExecutor implements PostgresExecutor {
  readonly statements: SqlStatement[] = []

  async query(statement: SqlStatement): Promise<readonly SqlRow[]> {
    this.statements.push(statement)
    if (statement.name === "oauth.shop_connection.resolve_active") {
      return [{
        organization_id: organizationId,
        shop_id: internalShopId,
        partner_application_id: partnerApplicationId,
        market: "ID",
        external_shop_id: "1819834906",
      }]
    }
    if (statement.name === "oauth.credential_subject.bind.lock") {
      return [{
        credential_status: "active",
        credential_partner_application_id: partnerApplicationId,
        shop_status: "active",
        shop_partner_application_id: partnerApplicationId,
        shop_market: "ID",
      }]
    }
    return []
  }

  transaction<T>(work: (executor: PostgresExecutor) => Promise<T>): Promise<T> {
    return work(this)
  }
}

function kms(): KmsEnvelopeCodec {
  return {
    async seal() {
      return { keyVersion: 7, algorithm: "kms-envelope-v1", ciphertext: "sealed-refresh-token" }
    },
    async unseal() {
      return CallbackCodeSchema.parse("refresh-token-fixture")
    },
  }
}

describe("PostgreSQL OAuth exchange committer", () => {
  it("encrypts only the refresh token and atomically saves one bound shop credential grant", async () => {
    // Given: an exact active shop mapping, worker KMS, and a successful Shopee exchange.
    const executor = new CommitExecutor()
    const committer = new PostgresOAuthExchangeCommitter({
      executor,
      kms: kms(),
      keyVersion: 7,
      now: () => "2026-09-16T00:00:00.000Z",
      nextIds: () => ({ credentialSubjectId: subjectId, grantId }),
    })

    // When: the worker commits the exchange output for the authorized callback claim.
    const evidence = await committer.commit({
      claim: claim(),
      exchange: {
        kind: "succeeded",
        accessToken: "access-token-fixture",
        refreshToken: "refresh-token-fixture",
        expiresIn: 14_400,
      },
    })

    // Then: SQL receives only an envelope and durable records bind the internal shop once.
    assert.equal(evidence.authorizedShopId, "1819834906")
    assert.deepEqual(evidence.subjects[0]?.shopIds, [internalShopId])
    const serialized = JSON.stringify(executor.statements)
    assert.equal(serialized.includes("access-token-fixture"), false)
    assert.equal(serialized.includes("refresh-token-fixture"), false)
    assert.equal(serialized.includes("sealed-refresh-token"), true)
  })

  it("denies persistence when the external shop has no active internal connection", async () => {
    // Given: an exchange committer whose scoped connection lookup returns no shop.
    const executor = new CommitExecutor()
    executor.query = async (statement) => {
      executor.statements.push(statement)
      return []
    }
    const committer = new PostgresOAuthExchangeCommitter({
      executor,
      kms: kms(),
      keyVersion: 7,
      now: () => "2026-09-16T00:00:00.000Z",
      nextIds: () => ({ credentialSubjectId: subjectId, grantId }),
    })

    // When: a worker attempts to commit an exchange for an unmapped shop.
    const result = committer.commit({
      claim: claim(),
      exchange: { kind: "succeeded", accessToken: "access", refreshToken: "refresh", expiresIn: 14_400 },
    })

    // Then: persistence fails closed before a credential subject can be created.
    await assert.rejects(result, ShopeeOAuthExchangeCommitError)
  })
})
