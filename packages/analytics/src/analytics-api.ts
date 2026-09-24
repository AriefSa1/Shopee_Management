import { z } from "zod"
import {
  AnalyticsProductIdSchema,
  AnalyticsTimestampSchema,
  OrganizationIdSchema,
  ShopIdSchema,
  type AnalyticsCollection,
  type AnalyticsProductId,
  type AnalyticsComparisonDecision,
  type OrganizationId,
  type ShopId,
} from "./model.ts"
import { compareAnalyticsSnapshots } from "./comparison.ts"
import { projectAnalyticsMetric } from "./projection.ts"

export type AnalyticsReadContext = {
  readonly organizationId: OrganizationId
  readonly accessibleShopIds: readonly ShopId[]
}

export type AnalyticsReadRequest = {
  readonly organizationId: OrganizationId
  readonly shopId: ShopId
}

export type AnalyticsApiDependencies = {
  readonly authenticate: (request: Request) => AnalyticsReadContext | null
  readonly read: (request: AnalyticsReadRequest) => Promise<AnalyticsCollection | null>
}

const AnalyticsQuerySchema = z
  .object({
    organizationId: OrganizationIdSchema,
    shopId: ShopIdSchema,
    productId: AnalyticsProductIdSchema,
    compareProductId: AnalyticsProductIdSchema.optional(),
    now: AnalyticsTimestampSchema,
    maximumAgeMinutes: z.coerce.number().int().nonnegative().max(43_200),
  })
  .strict()

type AnalyticsQuery = z.infer<typeof AnalyticsQuerySchema>

export async function createAnalyticsApiHandler(
  request: Request,
  dependencies: AnalyticsApiDependencies,
): Promise<Response> {
  if (!request.headers.get("authorization")?.startsWith("Bearer ")) {
    return json({ error: { code: "authentication_required" } }, 401)
  }
  const context = dependencies.authenticate(request)
  if (context === null) return json({ error: { code: "authentication_required" } }, 401)

  const query = parseQuery(request)
  if (query === null) return json({ error: { code: "invalid_analytics_request" } }, 400)
  if (query.organizationId !== context.organizationId) {
    return json({ error: { code: "organization_mismatch" } }, 403)
  }
  if (!context.accessibleShopIds.includes(query.shopId)) {
    return json({ error: { code: "shop_not_accessible" } }, 403)
  }

  try {
    const collection = await dependencies.read({ organizationId: query.organizationId, shopId: query.shopId })
    if (collection === null) return json({ error: { code: "analytics_not_found" } }, 404)
    if (collection.run.organizationId !== query.organizationId || collection.run.shopId !== query.shopId) {
      return json({ error: { code: "analytics_scope_mismatch" } }, 403)
    }
    const snapshot = collection.snapshots.find((entry) => entry.productId === query.productId)
    if (snapshot === undefined) return json({ error: { code: "product_not_found" } }, 404)

    const metric = projectAnalyticsMetric(snapshot, {
      now: query.now,
      maximumAgeMinutes: query.maximumAgeMinutes,
    })
    const comparison = query.compareProductId === undefined
      ? undefined
      : buildComparison(collection, snapshot.productId, query.compareProductId, query)
    return json({
      data: {
        organizationId: collection.run.organizationId,
        shopId: collection.run.shopId,
        productId: snapshot.productId,
        runStatus: collection.run.status,
        metric,
        ...(comparison === undefined ? {} : { comparison }),
      },
    }, 200)
  } catch (error) {
    if (error instanceof Error) return json({ error: { code: "analytics_provider_unavailable", retryable: true } }, 502)
    throw error
  }
}

function parseQuery(request: Request): AnalyticsQuery | null {
  const query = new URL(request.url).searchParams
  const parsed = AnalyticsQuerySchema.safeParse({
    organizationId: query.get("organizationId"),
    shopId: query.get("shopId"),
    productId: query.get("productId"),
    ...(query.get("compareProductId") === null ? {} : { compareProductId: query.get("compareProductId") }),
    now: query.get("now"),
    maximumAgeMinutes: query.get("maximumAgeMinutes"),
  })
  return parsed.success ? parsed.data : null
}

function buildComparison(
  collection: AnalyticsCollection,
  productId: AnalyticsProductId,
  compareProductId: AnalyticsProductId,
  query: AnalyticsQuery,
): AnalyticsComparisonDecision {
  const other = collection.snapshots.find((entry) => entry.productId === compareProductId)
  if (other === undefined) return { kind: "ineligible", reason: "metric_absent" }
  const current = collection.snapshots.find((entry) => entry.productId === productId)
  if (current === undefined) return { kind: "ineligible", reason: "metric_absent" }
  return compareAnalyticsSnapshots({
    left: other,
    leftRun: collection.run,
    right: current,
    rightRun: collection.run,
    now: query.now,
    maximumAgeMinutes: query.maximumAgeMinutes,
  })
}

function json(body: object, status: 200 | 400 | 401 | 403 | 404 | 502): Response {
  return Response.json(body, { status })
}
