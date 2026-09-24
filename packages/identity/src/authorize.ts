import type { Identity, OrganizationId, ShopId } from "./model.ts"
import { roleAllows, type Permission } from "./permissions.ts"
import type { MembershipRepository, ShopOwnershipResolver } from "./repositories.ts"

export type AuthorizationRequest = {
  readonly identity: Identity
  readonly organizationId: OrganizationId
  readonly permission: Permission
  readonly expectedAuthzRevision: number
  readonly shopIds: readonly ShopId[]
  readonly recoveryApproval: boolean
}

export type AuthorizationDecision =
  | { readonly decision: "allow"; readonly reason: "authorized" }
  | {
      readonly decision: "deny"
      readonly reason:
        | "membership_not_found"
        | "membership_revoked"
        | "authz_revision_stale"
        | "role_forbidden"
        | "shop_not_found"
        | "shop_organization_mismatch"
        | "recovery_approval_required"
    }

export type AuthorizationServices = {
  readonly memberships: MembershipRepository
  readonly shops: ShopOwnershipResolver
}

export async function authorize(
  request: AuthorizationRequest,
  services: AuthorizationServices,
): Promise<AuthorizationDecision> {
  const membership = await services.memberships.findByIdentityAndOrganization(
    request.identity,
    request.organizationId,
  )
  if (membership === null) {
    return { decision: "deny", reason: "membership_not_found" }
  }
  if (membership.status === "revoked") {
    return { decision: "deny", reason: "membership_revoked" }
  }
  if (membership.authzRevision !== request.expectedAuthzRevision) {
    return { decision: "deny", reason: "authz_revision_stale" }
  }
  if (!roleAllows(membership.role, request.permission, request.recoveryApproval)) {
    const reason =
      request.permission === "replay_dlq_recovery" && membership.role === "admin"
        ? "recovery_approval_required"
        : "role_forbidden"
    return { decision: "deny", reason }
  }
  for (const shopId of request.shopIds) {
    const ownership = await services.shops.resolve(shopId)
    if (ownership === null) {
      return { decision: "deny", reason: "shop_not_found" }
    }
    if (ownership.organizationId !== request.organizationId) {
      return { decision: "deny", reason: "shop_organization_mismatch" }
    }
  }
  return { decision: "allow", reason: "authorized" }
}
