import { z } from "zod"
import {
  ExternalOperationAttemptIdSchema,
  OrganizationIdSchema,
  ShopIdSchema,
  type ExternalOperationAttempt,
  type RecoveryDecision,
  type OrganizationId,
  type ShopId,
} from "./model.ts"

export type WriteRecoveryApiContext = {
  readonly organizationId: OrganizationId
  readonly actorId: string
  readonly accessibleShopIds: readonly ShopId[]
  readonly canResolve: boolean
}

export type WriteRecoveryApiDependencies = {
  readonly authenticate: (request: Request) => WriteRecoveryApiContext | null
  readonly list: (scope: { readonly organizationId: OrganizationId }) => Promise<readonly ExternalOperationAttempt[]>
  readonly find: (scope: { readonly organizationId: OrganizationId }, operationAttemptId: string) => Promise<ExternalOperationAttempt | null>
  readonly resolve: (input: { readonly attempt: ExternalOperationAttempt; readonly decision: RecoveryDecision }) => Promise<ExternalOperationAttempt>
}

const RecoveryQuerySchema = z.object({
  organizationId: OrganizationIdSchema,
  shopId: ShopIdSchema.optional(),
}).strict()

const RecoveryDecisionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("reauthenticate") }),
  z.object({ kind: z.literal("mark_failed"), reason: z.string().trim().min(1).max(255) }),
  z.object({ kind: z.literal("confirm_succeeded"), providerReference: z.string().trim().min(1).max(255) }),
])

const ResolveRequestSchema = z.object({
  organizationId: OrganizationIdSchema,
  operationAttemptId: ExternalOperationAttemptIdSchema,
  decision: RecoveryDecisionSchema,
}).strict()

export async function createWriteRecoveryApiHandler(
  request: Request,
  dependencies: WriteRecoveryApiDependencies,
): Promise<Response> {
  if (!hasBearer(request)) return json({ error: { code: "authentication_required" } }, 401)
  const context = dependencies.authenticate(request)
  if (context === null) return json({ error: { code: "authentication_required" } }, 401)

  if (request.method === "GET") return listOutcomeUnknown(request, context, dependencies)
  if (request.method === "POST") return resolveOutcomeUnknown(request, context, dependencies)
  return json({ error: { code: "method_not_allowed" } }, 405)
}

async function listOutcomeUnknown(
  request: Request,
  context: WriteRecoveryApiContext,
  dependencies: WriteRecoveryApiDependencies,
): Promise<Response> {
  const parsed = RecoveryQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams))
  if (!parsed.success) return json({ error: { code: "invalid_recovery_request" } }, 400)
  if (parsed.data.organizationId !== context.organizationId) return json({ error: { code: "organization_mismatch" } }, 403)

  try {
    const attempts = await dependencies.list({ organizationId: context.organizationId })
    const scoped = attempts.filter((attempt) =>
      attempt.state === "outcome_unknown" &&
      attempt.organizationId === context.organizationId &&
      context.accessibleShopIds.includes(attempt.destinationShopId) &&
      (parsed.data.shopId === undefined || parsed.data.shopId === attempt.destinationShopId),
    )
    if (parsed.data.shopId !== undefined && !context.accessibleShopIds.includes(parsed.data.shopId)) {
      return json({ error: { code: "shop_not_accessible" } }, 403)
    }
    return json({ data: { organizationId: context.organizationId, attempts: scoped.map(toSafeProjection), canResolve: context.canResolve } }, 200)
  } catch (error) {
    if (error instanceof Error) return json({ error: { code: "recovery_state_unavailable", retryable: true } }, 502)
    throw error
  }
}

async function resolveOutcomeUnknown(
  request: Request,
  context: WriteRecoveryApiContext,
  dependencies: WriteRecoveryApiDependencies,
): Promise<Response> {
  if (!context.canResolve) return json({ error: { code: "recovery_permission_required" } }, 403)
  let raw: unknown
  try {
    raw = await request.json()
  } catch (error) {
    if (error instanceof SyntaxError) return json({ error: { code: "invalid_recovery_request" } }, 400)
    throw error
  }
  const parsed = ResolveRequestSchema.safeParse(raw)
  if (!parsed.success) return json({ error: { code: "invalid_recovery_request" } }, 400)
  if (parsed.data.organizationId !== context.organizationId) return json({ error: { code: "organization_mismatch" } }, 403)

  try {
    const attempt = await dependencies.find({ organizationId: context.organizationId }, parsed.data.operationAttemptId)
    if (attempt === null) return json({ error: { code: "recovery_attempt_not_found" } }, 404)
    if (attempt.organizationId !== context.organizationId) return json({ error: { code: "organization_mismatch" } }, 403)
    if (attempt.operationAttemptId !== parsed.data.operationAttemptId) return json({ error: { code: "recovery_state_unavailable", retryable: true } }, 502)
    if (!context.accessibleShopIds.includes(attempt.destinationShopId)) return json({ error: { code: "shop_not_accessible" } }, 403)
    if (attempt.state !== "outcome_unknown") return json({ error: { code: "recovery_attempt_not_unknown" } }, 409)
    const decision = createRecoveryDecision(parsed.data.decision, context.actorId, new Date().toISOString())
    const resolved = await dependencies.resolve({ attempt, decision })
    if (
      resolved.organizationId !== context.organizationId ||
      resolved.operationAttemptId !== attempt.operationAttemptId ||
      resolved.destinationShopId !== attempt.destinationShopId ||
      resolved.state === "outcome_unknown" ||
      resolved.retryAllowed
    ) return json({ error: { code: "recovery_state_unavailable", retryable: true } }, 502)
    return json({ data: { organizationId: context.organizationId, attempt: toSafeProjection(resolved), operatorId: context.actorId } }, 202)
  } catch (error) {
    if (error instanceof Error) return json({ error: { code: "recovery_state_unavailable", retryable: true } }, 502)
    throw error
  }
}

function hasBearer(request: Request): boolean {
  return request.headers.get("authorization")?.startsWith("Bearer ") === true
}

type ParsedRecoveryDecision = z.infer<typeof RecoveryDecisionSchema>

function createRecoveryDecision(
  decision: ParsedRecoveryDecision,
  operatorId: string,
  decidedAt: string,
): RecoveryDecision {
  switch (decision.kind) {
    case "reauthenticate":
      return { kind: decision.kind, operatorId, decidedAt }
    case "mark_failed":
      return { kind: decision.kind, operatorId, decidedAt, reason: decision.reason }
    case "confirm_succeeded":
      return { kind: decision.kind, operatorId, decidedAt, providerReference: decision.providerReference }
    default:
      return assertNever(decision)
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unhandled recovery decision: ${String(value)}`)
}

function toSafeProjection(attempt: ExternalOperationAttempt): object {
  return {
    operationAttemptId: attempt.operationAttemptId,
    organizationId: attempt.organizationId,
    writeAttemptId: attempt.writeAttemptId,
    destinationShopId: attempt.destinationShopId,
    step: attempt.step,
    requestFingerprint: attempt.requestFingerprint,
    state: attempt.state,
    retryAllowed: attempt.retryAllowed,
    ...(attempt.outcomeReason === undefined ? {} : { outcomeReason: attempt.outcomeReason }),
    ...(attempt.providerReference === undefined ? {} : { providerReference: attempt.providerReference }),
  }
}

function json(body: object, status: 200 | 202 | 400 | 401 | 403 | 404 | 405 | 409 | 502): Response {
  return Response.json(body, { status })
}
