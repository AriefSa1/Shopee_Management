import {
  type RuntimePolicyVersion,
  type RuntimeRole,
  requireRuntimeCapability,
} from "../../runtime-boundaries/src/runtime-boundaries.ts"
import { normalizeAuthorizationGrant } from "./grants.ts"
import type {
  AuthorizationGrant,
  AuthorizationGrantFixture,
  OAuthCallbackClaim,
  OfficialOAuthTokenExchangeProvider,
  WorkerExchangeEvidence,
} from "./model.ts"
import { WorkerExchangeEvidenceSchema } from "./model.ts"

export type WorkerTokenExchangeRequest = {
  readonly runtimeRole: RuntimeRole
  readonly policyVersion: RuntimePolicyVersion
  readonly claim: OAuthCallbackClaim
}

export async function executeWorkerOnlyTokenExchange(
  request: WorkerTokenExchangeRequest,
  provider: OfficialOAuthTokenExchangeProvider,
): Promise<AuthorizationGrant> {
  const evidence = await executeWorkerOnlyTokenExchangeEvidence(request, provider)
  return normalizeAuthorizationGrant(toAuthorizationGrantFixture(evidence))
}

export async function executeWorkerOnlyTokenExchangeEvidence(
  request: WorkerTokenExchangeRequest,
  provider: OfficialOAuthTokenExchangeProvider,
): Promise<WorkerExchangeEvidence> {
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
  const evidence = WorkerExchangeEvidenceSchema.parse(await provider.exchange(request.claim))
  if (evidence.organizationId !== request.claim.organizationId) {
    throw new OAuthExchangeEvidenceError("exchange_organization_mismatch")
  }
  if (evidence.partnerApplicationId !== request.claim.partnerApplicationId) {
    throw new OAuthExchangeEvidenceError("exchange_partner_application_mismatch")
  }
  if (evidence.authorizedShopId !== request.claim.shopId) {
    throw new OAuthExchangeEvidenceError("exchange_shop_mismatch")
  }
  return evidence
}

export function toAuthorizationGrantFixture(evidence: WorkerExchangeEvidence): AuthorizationGrantFixture {
  return {
    grantId: evidence.grantId,
    organizationId: evidence.organizationId,
    partnerApplicationId: evidence.partnerApplicationId,
    grantKind: evidence.grantKind,
    grantedAt: evidence.grantedAt,
    subjects: evidence.subjects,
  }
}

export class OAuthExchangeEvidenceError extends Error {
  readonly name = "OAuthExchangeEvidenceError"
  readonly reason:
    | "exchange_organization_mismatch"
    | "exchange_partner_application_mismatch"
    | "exchange_shop_mismatch"

  constructor(reason: OAuthExchangeEvidenceError["reason"]) {
    super("OAuth exchange evidence did not match the claimed callback")
    this.reason = reason
  }
}
