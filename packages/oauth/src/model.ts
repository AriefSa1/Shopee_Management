import { z } from "zod"
import { ShopeeShopIdSchema, type ShopeeShopId } from "../../integrations/src/shopee-oauth.ts"
import {
  IdentitySchema,
  OrganizationIdSchema,
  ShopIdSchema,
  type Identity,
  type OrganizationId,
  type ShopId,
} from "../../identity/src/model.ts"

/**
 * Shopee refresh tokens remain valid for 30 days and are rotated on every
 * successful refresh. The persisted credential's `expires_at` tracks this
 * refresh-token lifetime (not the ~4h access-token `expire_in`), so the worker
 * refresh guard only forces reauthentication once the refresh token itself can
 * no longer be exchanged.
 */
export const OAUTH_REFRESH_CREDENTIAL_TTL_SECONDS = 30 * 24 * 60 * 60

export const OAuthAttemptIdSchema = z.string().uuid().brand("OAuthAttemptId")
export const AuthorizationGrantIdSchema = z.string().uuid().brand("AuthorizationGrantId")
export const CredentialSubjectIdSchema = z.string().uuid().brand("CredentialSubjectId")
export const PartnerApplicationIdSchema = z.string().trim().min(1).max(128).brand("PartnerApplicationId")
export const OAuthStateHashSchema = z.string().regex(/^[a-z0-9-]{32,128}$/).brand("OAuthStateHash")
export const CallbackCodeSchema = z.string().trim().min(1).max(2048).brand("CallbackCode")
export const OAuthRefreshTokenSchema = z.string().trim().min(1).max(4096).brand("OAuthRefreshToken")
export const OAuthMarketSchema = z.string().regex(/^[A-Z]{2}$/)

export type OAuthAttemptId = z.infer<typeof OAuthAttemptIdSchema>
export type AuthorizationGrantId = z.infer<typeof AuthorizationGrantIdSchema>
export type CredentialSubjectId = z.infer<typeof CredentialSubjectIdSchema>
export type PartnerApplicationId = z.infer<typeof PartnerApplicationIdSchema>
export type OAuthStateHash = z.infer<typeof OAuthStateHashSchema>
export type CallbackCode = z.infer<typeof CallbackCodeSchema>
export type OAuthRefreshToken = z.infer<typeof OAuthRefreshTokenSchema>
export type OAuthMarket = z.infer<typeof OAuthMarketSchema>
export { ShopeeShopIdSchema }
export type { ShopeeShopId }

export const OAuthStateStatusSchema = z.enum(["issued", "claimed", "expired"])
export type OAuthStateStatus = z.infer<typeof OAuthStateStatusSchema>

export const OAuthStateRecordSchema = z
  .object({
    attemptId: OAuthAttemptIdSchema,
    organizationId: OrganizationIdSchema,
    actor: IdentitySchema,
    partnerApplicationId: PartnerApplicationIdSchema,
    market: OAuthMarketSchema,
    stateHash: OAuthStateHashSchema,
    issuedAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
    status: OAuthStateStatusSchema,
  })
  .strict()
  .readonly()

export type OAuthStateRecord = z.infer<typeof OAuthStateRecordSchema>

export const OAuthCallbackInputSchema = z
  .object({
    stateHash: OAuthStateHashSchema,
    organizationId: OrganizationIdSchema,
    actor: IdentitySchema,
    receivedAt: z.string().datetime({ offset: true }),
    code: CallbackCodeSchema,
    shopId: ShopeeShopIdSchema,
  })
  .strict()
  .readonly()

export type OAuthCallbackInput = z.infer<typeof OAuthCallbackInputSchema>

export type OAuthCallbackClaim = {
  readonly attemptId: OAuthAttemptId
  readonly organizationId: OrganizationId
  readonly actor: Identity
  readonly partnerApplicationId: PartnerApplicationId
  readonly market: OAuthMarket
  readonly stateHash: OAuthStateHash
  readonly issuedAt: string
  readonly expiresAt: string
  readonly shopId: ShopeeShopId
  readonly callbackCode: CallbackCode
}

export type SafeOAuthAttempt = {
  readonly attemptId: OAuthAttemptId
  readonly organizationId: OrganizationId
  readonly partnerApplicationId: PartnerApplicationId
  readonly status: OAuthStateStatus
  readonly expiresAt: string
  readonly stateHash?: undefined
  readonly callbackCode?: undefined
}

export const GrantKindSchema = z.enum(["shop_account", "main_account"])
export type GrantKind = z.infer<typeof GrantKindSchema>

const CredentialSubjectFixtureSchema = z
  .object({
    credentialSubjectId: CredentialSubjectIdSchema,
    revision: z.number().int().positive(),
    keyVersion: z.number().int().positive(),
    shopIds: z.array(ShopIdSchema).min(1).max(100).readonly(),
  })
  .strict()
  .readonly()

const AuthorizationGrantFixtureFieldsSchema = z
  .object({
    grantId: AuthorizationGrantIdSchema,
    organizationId: OrganizationIdSchema,
    partnerApplicationId: PartnerApplicationIdSchema,
    grantKind: GrantKindSchema,
    grantedAt: z.string().datetime({ offset: true }),
    subjects: z.array(CredentialSubjectFixtureSchema).min(1).max(100).readonly(),
  })
  .strict()

export const AuthorizationGrantFixtureSchema = AuthorizationGrantFixtureFieldsSchema
  .readonly()

export type AuthorizationGrantFixture = z.infer<typeof AuthorizationGrantFixtureSchema>

export const WorkerExchangeEvidenceSchema = AuthorizationGrantFixtureFieldsSchema.extend({
  authorizedShopId: ShopeeShopIdSchema,
})
  .strict()
  .readonly()

export type WorkerExchangeEvidence = z.infer<typeof WorkerExchangeEvidenceSchema>

export type CredentialSubject = {
  readonly credentialSubjectId: CredentialSubjectId
  readonly revision: number
  readonly keyVersion: number
  readonly status: "active"
  readonly shopIds: readonly ShopId[]
}

export type ShopCredentialBinding = {
  readonly organizationId: OrganizationId
  readonly shopId: ShopId
  readonly credentialSubjectId: CredentialSubjectId
  readonly status: "active"
}

export type AuthorizationGrant = {
  readonly grantId: AuthorizationGrantId
  readonly organizationId: OrganizationId
  readonly partnerApplicationId: PartnerApplicationId
  readonly grantKind: GrantKind
  readonly grantedAt: string
  readonly status: "active"
  readonly subjects: readonly CredentialSubject[]
  readonly bindings: readonly ShopCredentialBinding[]
}

export interface OfficialOAuthTokenExchangeProvider {
  exchange(claim: OAuthCallbackClaim): Promise<WorkerExchangeEvidence>
}
