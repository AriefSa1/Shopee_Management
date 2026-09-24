import { z } from "zod"
import {
  type Identity,
  IdentitySchema,
  type OrganizationId,
  OrganizationIdSchema,
} from "../../identity/src/model.ts"
import type { OAuthAttemptRecord, OAuthDurableRepository } from "./durable-contracts.ts"
import type { OAuthAttemptId, OAuthStateRecord } from "./model.ts"
import {
  CallbackCodeSchema,
  OAuthMarketSchema,
  type OAuthStateHashSchema,
  PartnerApplicationIdSchema,
  ShopeeShopIdSchema,
} from "./model.ts"
import type { OAuthCallbackHandoffResult } from "./postgres-oauth-callback-handoff.ts"
import {
  type CreateOAuthStateInput,
  claimOAuthCallback,
  type OAuthStateClaimDecision,
  type OAuthStateStore,
} from "./state.ts"

export type OAuthWebAuthContext = {
  readonly organizationId: OrganizationId
  readonly actor: Identity
}

export type OAuthStateIssueInput = CreateOAuthStateInput & {
  readonly attemptId: OAuthAttemptId
}

export type OAuthStateIssue = {
  readonly state: string
  readonly record: OAuthStateRecord
}

export type OAuthWebApiDependencies = {
  readonly authenticate: (request: Request) => OAuthWebAuthContext | null
  readonly authorize?: (
    request: Request,
    context: OAuthWebAuthContext,
  ) => boolean | Promise<boolean>
  readonly stateStore: OAuthStateStore
  readonly persistState?: (record: OAuthStateRecord) => Promise<void>
  readonly claimState?: (
    input: unknown,
  ) => OAuthStateClaimDecision | Promise<OAuthStateClaimDecision>
  readonly callbackHandoff?: (input: {
    readonly stateHash: ReturnType<typeof OAuthStateHashSchema.parse>
    readonly organizationId: OrganizationId
    readonly actor: Identity
    readonly receivedAt: string
    readonly code: ReturnType<typeof CallbackCodeSchema.parse>
    readonly shopId: ReturnType<typeof ShopeeShopIdSchema.parse>
  }) => Promise<OAuthCallbackHandoffResult>
  readonly durable: OAuthDurableRepository
  readonly now: () => string
  readonly stateLifetimeSeconds: number
  readonly nextAttemptId: () => OAuthAttemptId
  readonly hashState: (state: string) => ReturnType<typeof OAuthStateHashSchema.parse>
  readonly issueState: (input: OAuthStateIssueInput) => OAuthStateIssue
  readonly authorizationUrl: (input: OAuthStateIssue) => string
}

const OAuthStartQuerySchema = z
  .object({
    organizationId: OrganizationIdSchema,
    partnerApplicationId: PartnerApplicationIdSchema,
    market: OAuthMarketSchema,
  })
  .strict()

const OAuthCallbackQuerySchema = z
  .object({
    state: z.string().trim().min(1).max(4096),
    code: CallbackCodeSchema,
    shop_id: ShopeeShopIdSchema,
  })
  .strict()

export async function createOAuthStartApiHandler(
  request: Request,
  dependencies: OAuthWebApiDependencies,
): Promise<Response> {
  const context = authenticate(request, dependencies)
  if (context === null) return json({ error: { code: "authentication_required" } }, 401)
  if (dependencies.authorize !== undefined && !(await dependencies.authorize(request, context))) {
    return json({ error: { code: "oauth_permission_required" } }, 403)
  }
  const parsed = OAuthStartQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  )
  if (!parsed.success) return json({ error: { code: "invalid_oauth_start_request" } }, 400)
  if (parsed.data.organizationId !== context.organizationId) {
    return json({ error: { code: "organization_mismatch" } }, 403)
  }

  const attemptId = dependencies.nextAttemptId()
  const issuedAt = dependencies.now()
  const expiryInstant = Date.parse(issuedAt)
  if (!Number.isFinite(expiryInstant) || dependencies.stateLifetimeSeconds <= 0) {
    return json({ error: { code: "oauth_clock_unavailable" } }, 503)
  }
  const issued = dependencies.issueState({
    attemptId,
    organizationId: context.organizationId,
    actor: context.actor,
    partnerApplicationId: parsed.data.partnerApplicationId,
    market: parsed.data.market,
    stateHash: dependencies.hashState(attemptId),
    issuedAt,
    expiresAt: new Date(expiryInstant + dependencies.stateLifetimeSeconds * 1000).toISOString(),
  })
  const issuedRecord: OAuthStateRecord = {
    ...issued.record,
    stateHash: dependencies.hashState(issued.state),
  }
  dependencies.stateStore.replace(issuedRecord)
  if (dependencies.persistState !== undefined) await dependencies.persistState(issuedRecord)
  return json(
    {
      data: {
        organizationId: context.organizationId,
        partnerApplicationId: parsed.data.partnerApplicationId,
        market: parsed.data.market,
        state: issued.state,
        authorizationUrl: dependencies.authorizationUrl(issued),
        status: issued.record.status,
      },
    },
    200,
  )
}

export async function createOAuthCallbackApiHandler(
  request: Request,
  dependencies: OAuthWebApiDependencies,
): Promise<Response> {
  const context = authenticate(request, dependencies)
  if (context === null) return json({ error: { code: "authentication_required" } }, 401)
  if (dependencies.authorize !== undefined && !(await dependencies.authorize(request, context))) {
    return json({ error: { code: "oauth_permission_required" } }, 403)
  }
  const parsed = OAuthCallbackQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  )
  if (!parsed.success) return json({ error: { code: "invalid_oauth_callback_request" } }, 400)
  const callbackInput = {
    stateHash: dependencies.hashState(parsed.data.state),
    organizationId: context.organizationId,
    actor: context.actor,
    receivedAt: dependencies.now(),
    code: parsed.data.code,
    shopId: parsed.data["shop_id"],
  }
  if (dependencies.callbackHandoff !== undefined) {
    const handoff = await dependencies.callbackHandoff(callbackInput)
    if (handoff.kind === "denied") return deniedCallback(handoff.reason)
    return json(
      {
        data: {
          attemptId: handoff.attemptId,
          organizationId: callbackInput.organizationId,
          status: "claimed",
          next: "worker_exchange_pending",
        },
      },
      202,
    )
  }
  const decision =
    dependencies.claimState === undefined
      ? claimOAuthCallback(callbackInput, dependencies.stateStore)
      : await dependencies.claimState(callbackInput)
  if (decision.kind === "denied") return deniedCallback(decision.reason)

  const attempt: OAuthAttemptRecord = {
    attemptId: decision.claim.attemptId,
    organizationId: decision.claim.organizationId,
    actor: decision.claim.actor,
    partnerApplicationId: decision.claim.partnerApplicationId,
    stateHash: decision.claim.stateHash,
    status: "claimed",
    issuedAt: decision.claim.issuedAt,
    expiresAt: decision.claim.expiresAt,
  }
  await dependencies.durable.saveAttempt(attempt)
  return json(
    {
      data: {
        attemptId: decision.claim.attemptId,
        organizationId: decision.claim.organizationId,
        status: "claimed",
        next: "worker_exchange_pending",
      },
    },
    202,
  )
}

function authenticate(
  request: Request,
  dependencies: OAuthWebApiDependencies,
): OAuthWebAuthContext | null {
  const context = dependencies.authenticate(request)
  if (context === null) return null
  return {
    organizationId: OrganizationIdSchema.parse(context.organizationId),
    actor: IdentitySchema.parse(context.actor),
  }
}

function deniedCallback(
  reason:
    | "state_not_found"
    | "state_expired"
    | "state_already_claimed"
    | "state_organization_mismatch"
    | "state_actor_mismatch",
): Response {
  switch (reason) {
    case "state_not_found":
      return json({ error: { code: reason } }, 404)
    case "state_expired":
      return json({ error: { code: reason } }, 410)
    case "state_already_claimed":
      return json({ error: { code: reason } }, 409)
    case "state_actor_mismatch":
      return json({ error: { code: reason } }, 403)
    case "state_organization_mismatch":
      return json({ error: { code: reason } }, 403)
    default:
      return assertNever(reason)
  }
}

function json(body: object, status: 200 | 202 | 400 | 401 | 403 | 404 | 409 | 410 | 503): Response {
  return Response.json(body, { status })
}

function assertNever(value: never): never {
  throw new TypeError(`Unhandled OAuth callback decision: ${String(value)}`)
}
