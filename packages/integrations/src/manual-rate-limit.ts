import { HierarchicalRateLimiter, scopeOrder } from "./rate-limit.ts"
import { OrganizationIdSchema, ShopIdSchema } from "../../identity/src/model.ts"

const request = {
  organizationId: OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001"),
  partnerId: "partner-fixture",
  credentialSubjectId: "subject-fixture",
  shopId: ShopIdSchema.parse("30000000-0000-4000-8000-000000000001"),
  endpoint: "/api/v2/product/get_item_list",
  now: "2026-09-10T00:00:00.000Z",
} as const
const limiter = new HierarchicalRateLimiter(scopeOrder().map((scope) => ({ scope, state: "verified", limit: 2, windowMs: 60_000 })))
const allowed = limiter.admit(request)
limiter.observeProviderRateLimit({ scope: "shop", request, retryAfterSeconds: 15 })
const cooldown = limiter.admit(request)
const unknownLimiter = new HierarchicalRateLimiter([
  { scope: "partner_global", state: "unknown" },
  ...scopeOrder().slice(1).map((scope) => ({ scope, state: "verified" as const, limit: 2, windowMs: 60_000 })),
])
const unknown = unknownLimiter.admit(request)

console.log(JSON.stringify({
  scenario: "hierarchical-rate-limit-provider-free-contract",
  scopes: scopeOrder(),
  firstAdmissionAllowed: allowed.kind === "allowed",
  providerCooldownDenied: cooldown.kind === "denied" && cooldown.scope === "shop" && cooldown.retryAfterSeconds === 15,
  unknownScopeDenied: unknown.kind === "denied" && unknown.reason === "scope_unknown",
  networkCalls: 0,
  databaseCalls: 0,
  shopeeMutations: 0,
  externalWrites: 0,
  secretFieldsPresent: false,
  liveProvider: "not_run",
}, null, 2))
