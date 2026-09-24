import { z } from "zod"
import {
  OrganizationIdSchema,
  ShopIdSchema,
  type OrganizationId,
  type ShopId,
} from "../../identity/src/model.ts"
import {
  StagingFeatureFlagsSchema,
  StagingReconciliationSnapshotSchema,
  type StagingFeatureFlags,
  type StagingReconciliationSnapshot,
} from "./model.ts"
import { buildReadOnlyAlphaWorkflow } from "./controls.ts"

export type StagingReadContext = {
  readonly organizationId: OrganizationId
  readonly accessibleShopIds: readonly ShopId[]
}

export type StagingReadRequest = {
  readonly organizationId: OrganizationId
  readonly shopId: ShopId
}

export type StagingReadState = {
  readonly featureFlags: StagingFeatureFlags
  readonly reconciliation: StagingReconciliationSnapshot
}

export type StagingApiDependencies = {
  readonly authenticate: (request: Request) => StagingReadContext | null
  readonly read: (request: StagingReadRequest) => Promise<StagingReadState | null>
}

const StagingQuerySchema = z.object({
  organizationId: OrganizationIdSchema,
  shopId: ShopIdSchema,
}).strict()

export async function createStagingApiHandler(
  request: Request,
  dependencies: StagingApiDependencies,
): Promise<Response> {
  if (request.headers.get("authorization")?.startsWith("Bearer ") !== true) {
    return json({ error: { code: "authentication_required" } }, 401)
  }
  const context = dependencies.authenticate(request)
  if (context === null) return json({ error: { code: "authentication_required" } }, 401)

  const query = parseQuery(request)
  if (query === null) return json({ error: { code: "invalid_staging_request" } }, 400)
  if (query.organizationId !== context.organizationId) {
    return json({ error: { code: "organization_mismatch" } }, 403)
  }
  if (!context.accessibleShopIds.includes(query.shopId)) {
    return json({ error: { code: "shop_not_accessible" } }, 403)
  }

  try {
    const state = await dependencies.read(query)
    if (state === null) return json({ error: { code: "staging_state_not_found" } }, 404)
    const parsedState = parseState(state)
    if (
      parsedState.reconciliation.organizationId !== query.organizationId ||
      parsedState.reconciliation.shopId !== query.shopId
    ) {
      return json({ error: { code: "staging_scope_mismatch" } }, 403)
    }
    const workflow = buildReadOnlyAlphaWorkflow(parsedState)
    return json({
      data: {
        organizationId: workflow.organizationId,
        shopId: query.shopId,
        environment: workflow.environment,
        writeGate: workflow.writeGate,
        mutationPolicy: workflow.mutationPolicy,
        holdControl: workflow.holdControl,
        rollbackControl: workflow.rollbackControl,
        allowedOperations: workflow.allowedOperations,
        blockedOperations: workflow.blockedOperations,
      },
    }, 200)
  } catch (error) {
    if (error instanceof Error) return json({ error: { code: "staging_state_unavailable", retryable: true } }, 502)
    throw error
  }
}

function parseQuery(request: Request): StagingReadRequest | null {
  const query = new URL(request.url).searchParams
  const parsed = StagingQuerySchema.safeParse({
    organizationId: query.get("organizationId"),
    shopId: query.get("shopId"),
  })
  return parsed.success ? parsed.data : null
}

function parseState(state: StagingReadState): StagingReadState {
  return {
    featureFlags: StagingFeatureFlagsSchema.parse(state.featureFlags),
    reconciliation: StagingReconciliationSnapshotSchema.parse(state.reconciliation),
  }
}

function json(body: object, status: 200 | 400 | 401 | 403 | 404 | 502): Response {
  return Response.json(body, { status })
}
