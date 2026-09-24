import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { authorize, type AuthorizationServices } from "./authorize.ts"
import {
  IdentitySchema,
  OrganizationIdSchema,
  ShopIdSchema,
  UserIdSchema,
  type Membership,
  type ShopOwnership,
} from "./model.ts"

const ORGANIZATION_A = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
const ORGANIZATION_B = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000002")
const USER = UserIdSchema.parse("20000000-0000-4000-8000-000000000001")
const SHOP_A = ShopIdSchema.parse("30000000-0000-4000-8000-000000000001")
const SHOP_B = ShopIdSchema.parse("30000000-0000-4000-8000-000000000002")
const IDENTITY = IdentitySchema.parse({ issuer: "https://id.example.test", subject: "operator-1" })

function services(membership: Membership, shops: readonly ShopOwnership[]): AuthorizationServices {
  return {
    memberships: {
      async findByIdentityAndOrganization(identity, organizationId) {
        return identity.issuer === membership.identity.issuer &&
          identity.subject === membership.identity.subject &&
          organizationId === membership.organizationId
          ? membership
          : null
      },
    },
    shops: {
      async resolve(shopId) {
        return shops.find((shop) => shop.shopId === shopId) ?? null
      },
    },
  }
}

function membership(role: Membership["role"], status: Membership["status"]): Membership {
  return {
    organizationId: ORGANIZATION_A,
    userId: USER,
    identity: IDENTITY,
    role,
    status,
    authzRevision: 7,
  }
}

describe("organization-scoped authorization", () => {
  it("denies a revoked membership", async () => {
    // Given: a revoked Owner membership in the requested organization.
    const subject = membership("owner", "revoked")

    // When: the actor requests an otherwise Owner-authorized operation.
    const decision = await authorize(
      {
        identity: IDENTITY,
        organizationId: ORGANIZATION_A,
        permission: "manage_shop_connections",
        expectedAuthzRevision: 7,
        shopIds: [SHOP_A],
        recoveryApproval: false,
      },
      services(subject, [{ organizationId: ORGANIZATION_A, shopId: SHOP_A }]),
    )

    // Then: the server decision denies the revoked actor with a stable reason code.
    assert.deepEqual(decision, { decision: "deny", reason: "membership_revoked" })
  })

  it("denies Staff publication confirmation", async () => {
    // Given: an active Staff membership that owns the destination shop through its organization.
    const subject = membership("staff", "active")

    // When: the Staff actor requests confirmation/publication.
    const decision = await authorize(
      {
        identity: IDENTITY,
        organizationId: ORGANIZATION_A,
        permission: "confirm_publish",
        expectedAuthzRevision: 7,
        shopIds: [SHOP_A],
        recoveryApproval: false,
      },
      services(subject, [{ organizationId: ORGANIZATION_A, shopId: SHOP_A }]),
    )

    // Then: publication is denied by role.
    assert.deepEqual(decision, { decision: "deny", reason: "role_forbidden" })
  })

  it("denies cross-organization shop access", async () => {
    // Given: an active Owner in organization A and a shop owned by organization B.
    const subject = membership("owner", "active")

    // When: the Owner presents the foreign shop identifier under organization A.
    const decision = await authorize(
      {
        identity: IDENTITY,
        organizationId: ORGANIZATION_A,
        permission: "read_catalog_analytics_status",
        expectedAuthzRevision: 7,
        shopIds: [SHOP_B],
        recoveryApproval: false,
      },
      services(subject, [{ organizationId: ORGANIZATION_B, shopId: SHOP_B }]),
    )

    // Then: ownership mismatch is observable and denied.
    assert.deepEqual(decision, { decision: "deny", reason: "shop_organization_mismatch" })
  })

  it("denies a stale authorization revision", async () => {
    // Given: an active Admin whose stored revision has advanced to seven.
    const subject = membership("admin", "active")

    // When: a command created against revision six is revalidated.
    const decision = await authorize(
      {
        identity: IDENTITY,
        organizationId: ORGANIZATION_A,
        permission: "manual_sync",
        expectedAuthzRevision: 6,
        shopIds: [SHOP_A],
        recoveryApproval: false,
      },
      services(subject, [{ organizationId: ORGANIZATION_A, shopId: SHOP_A }]),
    )

    // Then: the stale authority is denied before the shop operation.
    assert.deepEqual(decision, { decision: "deny", reason: "authz_revision_stale" })
  })

  it("requires approval policy for Admin recovery", async () => {
    // Given: an active Admin and an organization-owned shop.
    const subject = membership("admin", "active")

    // When: recovery is requested without the required approval policy.
    const decision = await authorize(
      {
        identity: IDENTITY,
        organizationId: ORGANIZATION_A,
        permission: "replay_dlq_recovery",
        expectedAuthzRevision: 7,
        shopIds: [SHOP_A],
        recoveryApproval: false,
      },
      services(subject, [{ organizationId: ORGANIZATION_A, shopId: SHOP_A }]),
    )

    // Then: the conditional Admin permission is denied with its policy reason.
    assert.deepEqual(decision, {
      decision: "deny",
      reason: "recovery_approval_required",
    })
  })

  it("denies a forged organization identifier", async () => {
    // Given: an active Owner whose identity belongs only to organization A.
    const subject = membership("owner", "active")

    // When: the same identity is presented against organization B.
    const decision = await authorize(
      {
        identity: IDENTITY,
        organizationId: ORGANIZATION_B,
        permission: "manage_memberships_roles_settings",
        expectedAuthzRevision: 7,
        shopIds: [],
        recoveryApproval: false,
      },
      services(subject, []),
    )

    // Then: no membership is resolved for the forged scope.
    assert.deepEqual(decision, { decision: "deny", reason: "membership_not_found" })
  })
})
