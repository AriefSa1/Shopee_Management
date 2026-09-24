import { requireRuntimeCapability } from "../../runtime-boundaries/src/runtime-boundaries.ts"
import type { KmsEncryptionContext, KmsEnvelopeCodec } from "./durable-contracts.ts"
import type { CredentialSubjectId } from "./model.ts"
import { OAuthRefreshTokenSchema } from "./model.ts"
import type {
  CredentialRefreshDecision,
  PostgresCredentialRepository,
} from "./postgres-credentials.ts"
import type {
  OfficialOAuthTokenRefreshProvider,
  WorkerTokenRefreshRequest,
} from "./worker-refresh.ts"

export type PostgresWorkerTokenRefreshRequest = WorkerTokenRefreshRequest & {
  readonly credentialSubjectId: CredentialSubjectId
}

export async function executeWorkerOnlyPostgresCredentialRefresh(
  request: PostgresWorkerTokenRefreshRequest,
  dependencies: {
    readonly credentials: PostgresCredentialRepository
    readonly kms: KmsEnvelopeCodec
    readonly provider: OfficialOAuthTokenRefreshProvider
    readonly now: () => string
  },
): Promise<CredentialRefreshDecision> {
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
    return { kind: "denied", reason: "stale_credential_revision" }
  }

  const updatedAt = dependencies.now()
  const kmsContext: KmsEncryptionContext = {
    purpose: "oauth_refresh_token",
    organizationId: request.organizationId,
    partnerApplicationId: request.partnerApplicationId,
    credentialSubjectId: request.credentialSubjectId,
    market: request.market,
  }
  return dependencies.credentials.withRefreshLease(
    {
      organizationId: request.organizationId,
      credentialSubjectId: request.credentialSubjectId,
      expectedRevision: request.expectedRevision,
      updatedAt,
    },
    async (subject) => {
      // The stored `expires_at` tracks the access-token style lifetime and must not
      // gate the refresh itself: a refresh is exactly what is needed once that
      // window lapses. Shopee remains the authority on whether the refresh token is
      // still valid - if it has truly expired the provider call below fails and the
      // credential is fenced to reauthentication.
      let refreshToken: Awaited<ReturnType<KmsEnvelopeCodec["unseal"]>>
      try {
        refreshToken = OAuthRefreshTokenSchema.parse(
          await dependencies.kms.unseal(subject.envelope, kmsContext),
        )
      } catch {
        return { outcome: "outcome_unknown" }
      }

      let response: Awaited<ReturnType<OfficialOAuthTokenRefreshProvider["refresh"]>>
      try {
        response = await dependencies.provider.refresh({
          organizationId: request.organizationId,
          credentialSubjectId: request.credentialSubjectId,
          expectedRevision: request.expectedRevision,
          refreshToken,
        })
      } catch {
        return { outcome: "outcome_unknown" }
      }

      try {
        return {
          outcome: "rotated",
          envelope: await dependencies.kms.seal(
            response.refreshToken,
            request.keyVersion,
            kmsContext,
          ),
          expiresAt: response.expiresAt,
        }
      } catch {
        return { outcome: "outcome_unknown" }
      }
    },
  )
}
