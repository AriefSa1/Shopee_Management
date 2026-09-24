import type { ShopeeTokenExchangeResult } from "../../integrations/src/shopee-oauth.ts"
import type { PostgresExecutor } from "../../delivery/src/postgres-delivery.ts"
import { AuthorizationGrantIdSchema, CredentialSubjectIdSchema, OAUTH_REFRESH_CREDENTIAL_TTL_SECONDS, OAuthRefreshTokenSchema, type OAuthCallbackClaim, type WorkerExchangeEvidence } from "./model.ts"
import {
  KmsEncryptionContextSchema,
  type EncryptedCredentialEnvelope,
  type KmsEnvelopeCodec,
} from "./durable-contracts.ts"
import { PostgresCredentialRepository } from "./postgres-credentials.ts"
import { PostgresOAuthGrantRepository } from "./postgres-grants.ts"
import { PostgresOAuthShopConnectionResolver } from "./postgres-shop-connection-resolver.ts"

type SuccessfulShopeeTokenExchange = Extract<ShopeeTokenExchangeResult, { readonly kind: "succeeded" }>

export type PostgresOAuthExchangeCommitterInput = {
  readonly executor: PostgresExecutor
  readonly kms: KmsEnvelopeCodec
  readonly keyVersion: number
  readonly now: () => string
  readonly nextIds: () => { readonly credentialSubjectId: string; readonly grantId: string }
}

export class ShopeeOAuthExchangeCommitError extends Error {
  readonly name = "ShopeeOAuthExchangeCommitError"
  readonly reason: "invalid_key_version" | "invalid_time" | "invalid_exchange_expiry" | "shop_connection_not_found" | "token_encryption_failed"

  constructor(reason: ShopeeOAuthExchangeCommitError["reason"]) {
    super("Shopee OAuth exchange could not be committed")
    this.reason = reason
  }
}

export class PostgresOAuthExchangeCommitter {
  private readonly input: PostgresOAuthExchangeCommitterInput

  constructor(input: PostgresOAuthExchangeCommitterInput) {
    this.input = input
  }

  async commit(input: {
    readonly claim: OAuthCallbackClaim
    readonly exchange: SuccessfulShopeeTokenExchange
  }): Promise<WorkerExchangeEvidence> {
    if (!Number.isInteger(this.input.keyVersion) || this.input.keyVersion < 1) {
      throw new ShopeeOAuthExchangeCommitError("invalid_key_version")
    }
    const ids = this.input.nextIds()
    const credentialSubjectId = CredentialSubjectIdSchema.parse(ids.credentialSubjectId)
    const grantId = AuthorizationGrantIdSchema.parse(ids.grantId)
    const grantedAt = validInstant(this.input.now())
    const expiresAt = exchangeExpiry(grantedAt, OAUTH_REFRESH_CREDENTIAL_TTL_SECONDS)
    const refreshToken = OAuthRefreshTokenSchema.parse(input.exchange.refreshToken)
    const context = KmsEncryptionContextSchema.parse({
      purpose: "oauth_refresh_token",
      organizationId: input.claim.organizationId,
      partnerApplicationId: input.claim.partnerApplicationId,
      credentialSubjectId,
      market: input.claim.market,
    })
    let envelope: EncryptedCredentialEnvelope
    try {
      envelope = await this.input.kms.seal(refreshToken, this.input.keyVersion, context)
    } catch {
      throw new ShopeeOAuthExchangeCommitError("token_encryption_failed")
    }
    return this.input.executor.transaction(async (transaction) => {
      const connection = await new PostgresOAuthShopConnectionResolver(transaction).resolve(input.claim)
      if (connection === undefined) throw new ShopeeOAuthExchangeCommitError("shop_connection_not_found")
      const credentials = new PostgresCredentialRepository(transaction)
      await credentials.saveSubject({
        organizationId: input.claim.organizationId,
        credentialSubjectId,
        partnerApplicationId: input.claim.partnerApplicationId,
        revision: 1,
        status: "active",
        expiresAt,
        envelope,
      })
      await credentials.bindShop({
        organizationId: input.claim.organizationId,
        shopId: connection.shopId,
        credentialSubjectId,
        status: "active",
      })
      const evidence: WorkerExchangeEvidence = {
        grantId,
        organizationId: input.claim.organizationId,
        partnerApplicationId: input.claim.partnerApplicationId,
        grantKind: "shop_account",
        grantedAt,
        subjects: [{ credentialSubjectId, revision: 1, keyVersion: envelope.keyVersion, shopIds: [connection.shopId] }],
        authorizedShopId: input.claim.shopId,
      }
      await new PostgresOAuthGrantRepository(transaction).saveGrant({
        grantId: evidence.grantId,
        organizationId: evidence.organizationId,
        partnerApplicationId: evidence.partnerApplicationId,
        grantKind: evidence.grantKind,
        grantedAt: evidence.grantedAt,
        subjects: evidence.subjects,
      })
      return evidence
    })
  }
}

function validInstant(value: string): string {
  const instant = Date.parse(value)
  if (!Number.isFinite(instant)) throw new ShopeeOAuthExchangeCommitError("invalid_time")
  return new Date(instant).toISOString()
}

function exchangeExpiry(grantedAt: string, expiresIn: number): string {
  if (!Number.isInteger(expiresIn) || expiresIn < 1) {
    throw new ShopeeOAuthExchangeCommitError("invalid_exchange_expiry")
  }
  const expiry = Date.parse(grantedAt) + (expiresIn * 1_000)
  if (!Number.isFinite(expiry)) throw new ShopeeOAuthExchangeCommitError("invalid_exchange_expiry")
  return new Date(expiry).toISOString()
}
