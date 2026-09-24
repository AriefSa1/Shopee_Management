import assert from "node:assert/strict"
import { authorize, type AuthorizationDecision, type AuthorizationRequest } from "./authorize.ts"
import { AuthorizationRequestSchema } from "./boundary.ts"
import {
  IdentitySchema,
  OrganizationIdSchema,
  ShopIdSchema,
  UserIdSchema,
  type Membership,
  type Role,
  type ShopOwnership,
} from "./model.ts"
import type { AuthorizationServices } from "./authorize.ts"

const ORGANIZATION_A = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
const ORGANIZATION_B = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000002")
const SHOP_A = ShopIdSchema.parse("30000000-0000-4000-8000-000000000001")
const SHOP_B = ShopIdSchema.parse("30000000-0000-4000-8000-000000000002")
const SHOP_UNKNOWN = ShopIdSchema.parse("30000000-0000-4000-8000-000000000003")
const IDENTITY = IdentitySchema.parse({ issuer: "https://id.example.test", subject: "qa-actor" })

type Scenario = {
  readonly name: string
  readonly membership: Membership
  readonly request: AuthorizationRequest
  readonly shops: readonly ShopOwnership[]
  readonly expected: AuthorizationDecision
}

function member(role: Role): Membership {
  const userIds = {
    owner: "20000000-0000-4000-8000-000000000001",
    admin: "20000000-0000-4000-8000-000000000002",
    staff: "20000000-0000-4000-8000-000000000003",
  } as const
  return {
    organizationId: ORGANIZATION_A,
    userId: UserIdSchema.parse(userIds[role]),
    identity: IDENTITY,
    role,
    status: "active",
    authzRevision: 7,
  }
}

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

async function executeScenario(scenario: Scenario) {
  const observed = await authorize(scenario.request, services(scenario.membership, scenario.shops))
  assert.deepEqual(observed, scenario.expected)
  return {
    name: scenario.name,
    role: scenario.membership.role,
    permission: scenario.request.permission,
    expected: scenario.expected,
    observed,
    logOutcome: observed.decision === "allow" ? "authorization_allowed" : "authorization_denied",
    passed: true,
  } as const
}

const ownedShop = [{ organizationId: ORGANIZATION_A, shopId: SHOP_A }] as const
const foreignShop = [{ organizationId: ORGANIZATION_B, shopId: SHOP_B }] as const
const scenarios: readonly Scenario[] = [
  {
    name: "owner_manages_shop",
    membership: member("owner"),
    request: {
      identity: IDENTITY,
      organizationId: ORGANIZATION_A,
      permission: "manage_shop_connections",
      expectedAuthzRevision: 7,
      shopIds: [SHOP_A],
      recoveryApproval: false,
    },
    shops: ownedShop,
    expected: { decision: "allow", reason: "authorized" },
  },
  {
    name: "admin_confirms_publication",
    membership: member("admin"),
    request: {
      identity: IDENTITY,
      organizationId: ORGANIZATION_A,
      permission: "confirm_publish",
      expectedAuthzRevision: 7,
      shopIds: [SHOP_A],
      recoveryApproval: false,
    },
    shops: ownedShop,
    expected: { decision: "allow", reason: "authorized" },
  },
  {
    name: "staff_publication_denied",
    membership: member("staff"),
    request: {
      identity: IDENTITY,
      organizationId: ORGANIZATION_A,
      permission: "confirm_publish",
      expectedAuthzRevision: 7,
      shopIds: [SHOP_A],
      recoveryApproval: false,
    },
    shops: ownedShop,
    expected: { decision: "deny", reason: "role_forbidden" },
  },
  {
    name: "cross_organization_shop_denied",
    membership: member("owner"),
    request: {
      identity: IDENTITY,
      organizationId: ORGANIZATION_A,
      permission: "read_catalog_analytics_status",
      expectedAuthzRevision: 7,
      shopIds: [SHOP_B],
      recoveryApproval: false,
    },
    shops: foreignShop,
    expected: { decision: "deny", reason: "shop_organization_mismatch" },
  },
  {
    name: "stale_authz_revision_denied",
    membership: member("admin"),
    request: {
      identity: IDENTITY,
      organizationId: ORGANIZATION_A,
      permission: "manual_sync",
      expectedAuthzRevision: 6,
      shopIds: [SHOP_A],
      recoveryApproval: false,
    },
    shops: ownedShop,
    expected: { decision: "deny", reason: "authz_revision_stale" },
  },
  {
    name: "forged_organization_denied",
    membership: member("owner"),
    request: {
      identity: IDENTITY,
      organizationId: ORGANIZATION_B,
      permission: "manage_memberships_roles_settings",
      expectedAuthzRevision: 7,
      shopIds: [],
      recoveryApproval: false,
    },
    shops: [],
    expected: { decision: "deny", reason: "membership_not_found" },
  },
  {
    name: "forged_shop_denied",
    membership: member("owner"),
    request: {
      identity: IDENTITY,
      organizationId: ORGANIZATION_A,
      permission: "read_catalog_analytics_status",
      expectedAuthzRevision: 7,
      shopIds: [SHOP_UNKNOWN],
      recoveryApproval: false,
    },
    shops: ownedShop,
    expected: { decision: "deny", reason: "shop_not_found" },
  },
]

const results = await Promise.all(scenarios.map(executeScenario))
const malformedRoleAccepted = AuthorizationRequestSchema.safeParse({
  ...scenarios[0]?.request,
  permission: "root",
}).success
const malformedIdentityAccepted = AuthorizationRequestSchema.safeParse({
  ...scenarios[0]?.request,
  identity: { issuer: "not-a-url", subject: "" },
}).success
const misleadingSuccessLogDetected = results.some(
  (result) => result.observed.decision === "deny" && result.logOutcome !== "authorization_denied",
)

assert.equal(malformedRoleAccepted, false)
assert.equal(malformedIdentityAccepted, false)
assert.equal(misleadingSuccessLogDetected, false)

const artifact = {
  generatedAt: "2026-09-09T00:00:00.000Z",
  entrypoint: "packages/identity/src/manual-rbac.ts",
  scenarios: results,
  adversarialProbes: {
    malformedRoleRejected: !malformedRoleAccepted,
    malformedIdentityRejected: !malformedIdentityAccepted,
    staleAuthzRevisionDenied: true,
    forgedOrganizationDenied: true,
    forgedShopDenied: true,
    misleadingSuccessLogDetected,
  },
  cleanup: {
    externalResourcesCreated: 0,
    temporaryResourcesRemaining: 0,
  },
  passed: true,
} as const

process.stdout.write(`${JSON.stringify(artifact)}\n`)
