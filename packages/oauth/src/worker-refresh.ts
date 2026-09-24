import {
  requireRuntimeCapability,
  type RuntimePolicyVersion,
  type RuntimeRole,
} from "../../runtime-boundaries/src/runtime-boundaries.ts"
import type {
  EncryptedCredentialEnvelope,
  KmsEncryptionContext,
  KmsMarket,
  KmsEnvelopeCodec,
  OAuthDurableRepository,
  RefreshOutcome,
} from "./durable-contracts.ts"
import type { CredentialSubjectId, OAuthRefreshToken, PartnerApplicationId } from "./model.ts"
import { OAuthRefreshTokenSchema } from "./model.ts"

export type WorkerTokenRefreshRequest = {
  readonly runtimeRole: RuntimeRole
  readonly policyVersion: RuntimePolicyVersion
  readonly organizationId: Parameters<OAuthDurableRepository["readEnvelope"]>[0]
  readonly partnerApplicationId: PartnerApplicationId
  readonly market: KmsMarket
  readonly credentialSubjectId: CredentialSubjectId
  readonly expectedRevision: number
  readonly keyVersion: number
}

export type OfficialOAuthTokenRefreshProvider = {
  refresh(input: {
    readonly organizationId: WorkerTokenRefreshRequest["organizationId"]
    readonly credentialSubjectId: CredentialSubjectId
    readonly expectedRevision: number
    readonly refreshToken: OAuthRefreshToken
  }): Promise<{ readonly refreshToken: OAuthRefreshToken; readonly expiresAt: string }>
}

export type WorkerTokenRefreshDecision =
  | { readonly kind: "rotated"; readonly outcome: Extract<RefreshOutcome, { kind: "rotated" }> }
  | { readonly kind: "reauth_required"; readonly outcome: Extract<RefreshOutcome, { kind: "reauth_required" }> }
  | { readonly kind: "denied"; readonly outcome: Extract<RefreshOutcome, { kind: "denied" }> }

export class OAuthRefreshOutcomeUnknownError extends Error {
  readonly name = "OAuthRefreshOutcomeUnknownError"

  constructor() {
    super("OAuth refresh outcome is unknown; reauthorization is required")
  }
}

export async function executeWorkerOnlyTokenRefresh(
  request: WorkerTokenRefreshRequest,
  dependencies: {
    readonly durable: OAuthDurableRepository
    readonly kms: KmsEnvelopeCodec
    readonly provider: OfficialOAuthTokenRefreshProvider
    readonly now: () => string
  },
): Promise<WorkerTokenRefreshDecision> {
  requireRuntimeCapability({
    role: request.runtimeRole,
    capability: "secret_provider",
    policyVersion: request.policyVersion,
  })
  requireRuntimeCapability({
    role: request.runtimeRole,
    capability: "shopee_call",
    policyVersion: request.policyVersion,
  })
  if (!Number.isInteger(request.expectedRevision) || request.expectedRevision < 1) {
    return { kind: "denied", outcome: { kind: "denied", reason: "stale_credential_revision" } }
  }

  const kmsContext: KmsEncryptionContext = {
    purpose: "oauth_refresh_token",
    organizationId: request.organizationId,
    partnerApplicationId: request.partnerApplicationId,
    credentialSubjectId: request.credentialSubjectId,
    market: request.market,
  }

  const currentEnvelope = await dependencies.durable.readEnvelope(
    request.organizationId,
    request.credentialSubjectId,
  )
  const refreshToken = OAuthRefreshTokenSchema.parse(await dependencies.kms.unseal(currentEnvelope, kmsContext))

  let response: { readonly refreshToken: OAuthRefreshToken; readonly expiresAt: string }
  try {
    response = await dependencies.provider.refresh({
      organizationId: request.organizationId,
      credentialSubjectId: request.credentialSubjectId,
      expectedRevision: request.expectedRevision,
      refreshToken,
    })
  } catch {
    const outcome = await dependencies.durable.recordRefreshOutcome({
      organizationId: request.organizationId,
      credentialSubjectId: request.credentialSubjectId,
      expectedRevision: request.expectedRevision,
      outcome: "outcome_unknown",
      envelope: currentEnvelope,
    })
    if (outcome.kind === "reauth_required") {
      return { kind: "reauth_required", outcome }
    }
    if (outcome.kind === "denied") return { kind: "denied", outcome }
    throw new OAuthRefreshOutcomeUnknownError()
  }

  let nextEnvelope: EncryptedCredentialEnvelope
  try {
    nextEnvelope = await dependencies.kms.seal(response.refreshToken, request.keyVersion, kmsContext)
  } catch {
    const outcome = await dependencies.durable.recordRefreshOutcome({
      organizationId: request.organizationId,
      credentialSubjectId: request.credentialSubjectId,
      expectedRevision: request.expectedRevision,
      outcome: "outcome_unknown",
      envelope: currentEnvelope,
    })
    if (outcome.kind === "reauth_required") return { kind: "reauth_required", outcome }
    if (outcome.kind === "denied") return { kind: "denied", outcome }
    throw new OAuthRefreshOutcomeUnknownError()
  }

  const outcome = await dependencies.durable.recordRefreshOutcome({
    organizationId: request.organizationId,
    credentialSubjectId: request.credentialSubjectId,
    expectedRevision: request.expectedRevision,
    outcome: "rotated",
    envelope: nextEnvelope,
    expiresAt: response.expiresAt,
  })
  if (outcome.kind === "rotated") return { kind: "rotated", outcome }
  if (outcome.kind === "denied") return { kind: "denied", outcome }
  return { kind: "reauth_required", outcome }
}
