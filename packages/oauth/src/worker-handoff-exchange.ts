import { requireRuntimeCapability } from "../../runtime-boundaries/src/runtime-boundaries.ts"
import {
  type EncryptedCredentialEnvelope,
  KmsEncryptionContextSchema,
  type KmsEnvelopeCodec,
} from "./durable-contracts.ts"
import { normalizeAuthorizationGrant } from "./grants.ts"
import type {
  AuthorizationGrant,
  AuthorizationGrantFixture,
  OAuthCallbackClaim,
  OfficialOAuthTokenExchangeProvider,
} from "./model.ts"
import { CallbackCodeSchema } from "./model.ts"
import {
  executeWorkerOnlyTokenExchangeEvidence,
  toAuthorizationGrantFixture,
  type WorkerTokenExchangeRequest,
} from "./worker-exchange.ts"

export type OAuthExchangeHandoff = {
  readonly claim: Omit<OAuthCallbackClaim, "callbackCode">
  readonly envelope: EncryptedCredentialEnvelope
}

export type WorkerHandoffExchangeDependencies = {
  readonly kms: KmsEnvelopeCodec
  readonly provider: OfficialOAuthTokenExchangeProvider
  readonly persistence: WorkerHandoffExchangePersistence
  readonly completeHandoff?: (attemptId: OAuthCallbackClaim["attemptId"]) => Promise<void>
}

export type WorkerHandoffExchangePersistence =
  | {
      readonly kind: "external_grant_repository"
      readonly saveGrant: (grant: AuthorizationGrantFixture) => Promise<void>
    }
  | { readonly kind: "provider_commits" }

export async function executeWorkerHandoffExchange(
  request: Omit<WorkerTokenExchangeRequest, "claim"> & { readonly handoff: OAuthExchangeHandoff },
  dependencies: WorkerHandoffExchangeDependencies,
): Promise<AuthorizationGrant> {
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
  const context = KmsEncryptionContextSchema.parse({
    purpose: "oauth_callback_code",
    organizationId: request.handoff.claim.organizationId,
    partnerApplicationId: request.handoff.claim.partnerApplicationId,
    market: request.handoff.claim.market,
  })
  const callbackCode = CallbackCodeSchema.parse(
    await dependencies.kms.unseal(request.handoff.envelope, context),
  )
  const claim: OAuthCallbackClaim = { ...request.handoff.claim, callbackCode }
  const evidence = await executeWorkerOnlyTokenExchangeEvidence(
    { ...request, claim },
    dependencies.provider,
  )
  switch (dependencies.persistence.kind) {
    case "external_grant_repository":
      await dependencies.persistence.saveGrant(toAuthorizationGrantFixture(evidence))
      break
    case "provider_commits":
      break
    default:
      return assertNever(dependencies.persistence)
  }
  if (dependencies.completeHandoff !== undefined) {
    await dependencies.completeHandoff(claim.attemptId)
  }
  return normalizeAuthorizationGrant(toAuthorizationGrantFixture(evidence))
}

function assertNever(value: never): never {
  throw new TypeError(`Unhandled OAuth handoff persistence mode: ${String(value)}`)
}
