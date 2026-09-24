import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { OrganizationIdSchema, ShopIdSchema } from "../../identity/src/model.ts"
import { HierarchicalRateLimiter, type RateLimitPolicy, scopeOrder } from "./rate-limit.ts"

const organizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
const shopId = ShopIdSchema.parse("30000000-0000-4000-8000-000000000001")
const request = {
  organizationId,
  partnerId: "partner-fixture",
  credentialSubjectId: "subject-fixture",
  shopId,
  endpoint: "/api/v2/product/get_item_list",
  now: "2026-09-10T00:00:00.000Z",
} as const

function policies(overrides: Partial<Record<RateLimitPolicy["scope"], RateLimitPolicy>> = {}): readonly RateLimitPolicy[] {
  return scopeOrder().map((scope) => overrides[scope] ?? { scope, state: "verified", limit: 2, windowMs: 60_000 })
}

describe("hierarchical rate-limit contract", () => {
  it("fails closed when any required scope is unknown", () => {
    const limiter = new HierarchicalRateLimiter(policies({ shop: { scope: "shop", state: "unknown" } }))
    assert.deepEqual(limiter.admit(request), { kind: "denied", reason: "scope_unknown", scope: "shop", retryAfterSeconds: 0 })
    assert.deepEqual(limiter.snapshot(), { bucketCount: 0, cooldownCount: 0 })
  })

  it("enforces all four scopes and reports the limiting scope", () => {
    const limiter = new HierarchicalRateLimiter(policies({ endpoint: { scope: "endpoint", state: "verified", limit: 1, windowMs: 60_000 } }))
    assert.equal(limiter.admit(request).kind, "allowed")
    assert.deepEqual(limiter.admit(request), { kind: "denied", reason: "rate_limited", scope: "endpoint", retryAfterSeconds: 60 })
  })

  it("uses the tightest higher-level scope before endpoint admission", () => {
    const limiter = new HierarchicalRateLimiter(policies({ partner_global: { scope: "partner_global", state: "verified", limit: 1, windowMs: 60_000 } }))
    assert.equal(limiter.admit(request).kind, "allowed")
    assert.deepEqual(limiter.admit({ ...request, endpoint: "/other" }), { kind: "denied", reason: "rate_limited", scope: "partner_global", retryAfterSeconds: 60 })
  })

  it("resets a fixed window without carrying the previous count", () => {
    const limiter = new HierarchicalRateLimiter(policies({ shop: { scope: "shop", state: "verified", limit: 1, windowMs: 60_000 } }))
    assert.equal(limiter.admit(request).kind, "allowed")
    const blocked = limiter.admit({ ...request, now: "2026-09-10T00:00:30.000Z" })
    assert.equal(blocked.kind, "denied")
    assert.equal(limiter.admit({ ...request, now: "2026-09-10T00:01:00.000Z" }).kind, "allowed")
  })

  it("honors provider retry-after as a local cooldown", () => {
    const limiter = new HierarchicalRateLimiter(policies())
    limiter.observeProviderRateLimit({ scope: "shop", request, retryAfterSeconds: 15 })
    assert.deepEqual(limiter.admit(request), { kind: "denied", reason: "rate_limited", scope: "shop", retryAfterSeconds: 15 })
    assert.equal(limiter.admit({ ...request, now: "2026-09-10T00:00:15.000Z" }).kind, "allowed")
  })

  it("rejects duplicate scope configuration", () => {
    assert.throws(
      () => new HierarchicalRateLimiter([
        { scope: "shop", state: "unknown" },
        { scope: "shop", state: "unknown" },
      ]),
      /duplicate_scope/,
    )
  })
})
