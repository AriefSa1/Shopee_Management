import type { Identity, Membership, OrganizationId, ShopId, ShopOwnership } from "./model.ts"

export interface MembershipRepository {
  findByIdentityAndOrganization(
    identity: Identity,
    organizationId: OrganizationId,
  ): Promise<Membership | null>
}

export interface ShopOwnershipResolver {
  resolve(shopId: ShopId): Promise<ShopOwnership | null>
}
