import {
  AuthorizationGrantFixtureSchema,
  type AuthorizationGrant,
  type AuthorizationGrantFixture,
  type CredentialSubject,
  type ShopCredentialBinding,
} from "./model.ts"
import type { OrganizationId, ShopId } from "../../identity/src/model.ts"

export type ShopBindingRequest = {
  readonly organizationId: OrganizationId
  readonly shopId: ShopId
}

export type ShopBindingDecision =
  | { readonly kind: "allowed"; readonly credentialSubjectId: CredentialSubject["credentialSubjectId"] }
  | { readonly kind: "denied"; readonly reason: "grant_organization_mismatch" | "shop_not_granted" }

export function normalizeAuthorizationGrant(input: AuthorizationGrantFixture): AuthorizationGrant {
  const fixture = AuthorizationGrantFixtureSchema.parse(input)
  const subjects = fixture.subjects.map<CredentialSubject>((subject) => ({
    credentialSubjectId: subject.credentialSubjectId,
    revision: subject.revision,
    keyVersion: subject.keyVersion,
    status: "active",
    shopIds: subject.shopIds,
  }))
  const bindings = subjects.flatMap((subject) =>
    subject.shopIds.map<ShopCredentialBinding>((shopId) => ({
      organizationId: fixture.organizationId,
      shopId,
      credentialSubjectId: subject.credentialSubjectId,
      status: "active",
    })),
  )
  ensureUniqueBindings(bindings)
  return {
    grantId: fixture.grantId,
    organizationId: fixture.organizationId,
    partnerApplicationId: fixture.partnerApplicationId,
    grantKind: fixture.grantKind,
    grantedAt: fixture.grantedAt,
    status: "active",
    subjects,
    bindings,
  }
}

export function authorizeShopCredentialBinding(
  request: ShopBindingRequest,
  grant: AuthorizationGrant,
): ShopBindingDecision {
  if (request.organizationId !== grant.organizationId) {
    return { kind: "denied", reason: "grant_organization_mismatch" }
  }
  const binding = grant.bindings.find((candidate) => candidate.shopId === request.shopId)
  return binding === undefined
    ? { kind: "denied", reason: "shop_not_granted" }
    : { kind: "allowed", credentialSubjectId: binding.credentialSubjectId }
}

function ensureUniqueBindings(bindings: readonly ShopCredentialBinding[]): void {
  const seen = new Set<ShopId>()
  for (const binding of bindings) {
    if (seen.has(binding.shopId)) {
      throw new OAuthGrantFixtureError("duplicate_shop_binding")
    }
    seen.add(binding.shopId)
  }
}

export class OAuthGrantFixtureError extends Error {
  readonly name = "OAuthGrantFixtureError"
  readonly reason: "duplicate_shop_binding"

  constructor(reason: "duplicate_shop_binding") {
    super("OAuth grant fixture is invalid")
    this.reason = reason
  }
}
