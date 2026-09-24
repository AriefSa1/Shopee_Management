import { z } from "zod"
import {
  OrganizationIdSchema,
  ShopIdSchema,
  type OrganizationId,
  type ShopId,
} from "../../identity/src/model.ts"

export const RateLimitScopeSchema = z.enum(["partner_global", "credential_subject", "shop", "endpoint"])
export type RateLimitScope = z.infer<typeof RateLimitScopeSchema>

const RateLimitIdentifierSchema = z.string().trim().min(1).max(255)
const RateLimitTimestampSchema = z.string().datetime({ offset: true })

export const RateLimitPolicySchema = z.discriminatedUnion("state", [
  z.object({
    scope: RateLimitScopeSchema,
    state: z.literal("verified"),
    limit: z.number().int().positive(),
    windowMs: z.number().int().positive(),
  }).strict(),
  z.object({
    scope: RateLimitScopeSchema,
    state: z.literal("unknown"),
  }).strict(),
]).readonly()
export type RateLimitPolicy = z.infer<typeof RateLimitPolicySchema>

export const RateLimitRequestSchema = z.object({
  organizationId: OrganizationIdSchema,
  partnerId: RateLimitIdentifierSchema,
  credentialSubjectId: RateLimitIdentifierSchema,
  shopId: ShopIdSchema,
  endpoint: RateLimitIdentifierSchema,
  now: RateLimitTimestampSchema,
}).strict().readonly()
export type RateLimitRequest = Omit<z.infer<typeof RateLimitRequestSchema>, "organizationId" | "shopId"> & {
  readonly organizationId: OrganizationId
  readonly shopId: ShopId
}

export const ProviderRateLimitObservationSchema = z.object({
  scope: RateLimitScopeSchema,
  request: RateLimitRequestSchema,
  retryAfterSeconds: z.number().int().nonnegative().max(86_400),
}).strict().readonly()
export type ProviderRateLimitObservation = z.infer<typeof ProviderRateLimitObservationSchema>

export type RateLimitDecision =
  | {
      readonly kind: "allowed"
      readonly reservation: {
        readonly observedAt: string
        readonly scopes: readonly RateLimitScope[]
      }
    }
  | {
      readonly kind: "denied"
      readonly reason: "scope_unknown" | "rate_limited"
      readonly scope: RateLimitScope
      readonly retryAfterSeconds: number
    }

type Bucket = { readonly windowStartMs: number; count: number }

export class HierarchicalRateLimiter {
  private readonly policies: ReadonlyMap<RateLimitScope, RateLimitPolicy>
  private readonly buckets = new Map<string, Bucket>()
  private readonly cooldowns = new Map<string, number>()

  constructor(rawPolicies: readonly RateLimitPolicy[]) {
    const policies = new Map<RateLimitScope, RateLimitPolicy>()
    for (const rawPolicy of rawPolicies) {
      const policy = RateLimitPolicySchema.parse(rawPolicy)
      if (policies.has(policy.scope)) throw new RateLimitContractError("duplicate_scope", policy.scope)
      policies.set(policy.scope, policy)
    }
    this.policies = policies
  }

  admit(rawRequest: RateLimitRequest): RateLimitDecision {
    const request = RateLimitRequestSchema.parse(rawRequest)
    const nowMs = Date.parse(request.now)

    for (const scope of scopeOrder()) {
      const policy = this.policies.get(scope)
      if (policy === undefined || policy.state === "unknown") {
        return { kind: "denied", reason: "scope_unknown", scope, retryAfterSeconds: 0 }
      }
      const key = scopeKey(scope, request)
      const cooldownUntil = this.cooldowns.get(key) ?? 0
      if (cooldownUntil > nowMs) {
        return {
          kind: "denied",
          reason: "rate_limited",
          scope,
          retryAfterSeconds: Math.ceil((cooldownUntil - nowMs) / 1_000),
        }
      }
      const bucket = this.readBucket(scope, key, policy, nowMs)
      if (bucket.count >= policy.limit) {
        return {
          kind: "denied",
          reason: "rate_limited",
          scope,
          retryAfterSeconds: Math.ceil((bucket.windowStartMs + policy.windowMs - nowMs) / 1_000),
        }
      }
    }

    for (const scope of scopeOrder()) {
      const policy = this.policies.get(scope)
      if (policy === undefined || policy.state === "unknown") throw new RateLimitContractError("incomplete_policy", scope)
      const key = scopeKey(scope, request)
      const bucket = this.readBucket(scope, key, policy, nowMs)
      this.buckets.set(bucketKey(scope, key), { ...bucket, count: bucket.count + 1 })
    }
    return { kind: "allowed", reservation: { observedAt: request.now, scopes: scopeOrder() } }
  }

  observeProviderRateLimit(rawObservation: ProviderRateLimitObservation): void {
    const observation = ProviderRateLimitObservationSchema.parse(rawObservation)
    const policy = this.policies.get(observation.scope)
    if (policy === undefined) throw new RateLimitContractError("scope_not_configured", observation.scope)
    const key = scopeKey(observation.scope, observation.request)
    const until = Date.parse(observation.request.now) + observation.retryAfterSeconds * 1_000
    this.cooldowns.set(key, Math.max(this.cooldowns.get(key) ?? 0, until))
  }

  snapshot(): { readonly bucketCount: number; readonly cooldownCount: number } {
    return { bucketCount: this.buckets.size, cooldownCount: this.cooldowns.size }
  }

  private readBucket(scope: RateLimitScope, key: string, policy: Extract<RateLimitPolicy, { state: "verified" }>, nowMs: number): Bucket {
    const storageKey = bucketKey(scope, key)
    const existing = this.buckets.get(storageKey)
    const windowStartMs = Math.floor(nowMs / policy.windowMs) * policy.windowMs
    if (existing?.windowStartMs === windowStartMs) return existing
    return { windowStartMs, count: 0 }
  }
}

export function scopeOrder(): readonly RateLimitScope[] {
  return ["partner_global", "credential_subject", "shop", "endpoint"]
}

function scopeKey(scope: RateLimitScope, request: RateLimitRequest): string {
  switch (scope) {
    case "partner_global":
      return `partner:${request.partnerId}`
    case "credential_subject":
      return `subject:${request.credentialSubjectId}`
    case "shop":
      return `shop:${request.organizationId}:${request.shopId}`
    case "endpoint":
      return `endpoint:${request.partnerId}:${request.endpoint}`
    default:
      return assertNever(scope)
  }
}

function bucketKey(scope: RateLimitScope, key: string): string {
  return `${scope}:${key}`
}

function assertNever(value: never): never {
  throw new RateLimitContractError("unsupported_scope", String(value))
}

class RateLimitContractError extends Error {
  readonly name = "RateLimitContractError"
  readonly code: "duplicate_scope" | "incomplete_policy" | "scope_not_configured" | "unsupported_scope"

  constructor(code: RateLimitContractError["code"], detail: string) {
    super(`Rate-limit contract error (${code}): ${detail}`)
    this.code = code
  }
}
