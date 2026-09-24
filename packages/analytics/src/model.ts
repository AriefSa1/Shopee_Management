import { z } from "zod"
import {
  OrganizationIdSchema,
  ShopIdSchema,
  type OrganizationId,
  type ShopId,
} from "../../identity/src/model.ts"

export { OrganizationIdSchema, ShopIdSchema }
export type { OrganizationId, ShopId }

export const AnalyticsCollectionRunIdSchema = z.string().uuid().brand("AnalyticsCollectionRunId")
export const AnalyticsProductIdSchema = z.string().trim().min(1).max(255).brand("AnalyticsProductId")
export const AnalyticsMetricDefinitionIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .brand("AnalyticsMetricDefinitionId")
export const AnalyticsTimestampSchema = z.string().datetime({ offset: true })
export const AnalyticsMetricUnitSchema = z.enum(["count", "score", "percentage"])
export const AnalyticsWindowSchema = z.enum(["rolling_30_days", "cumulative"])
export const AnalyticsCapabilitySchema = z.enum(["enabled", "unsupported"])

export type AnalyticsCollectionRunId = z.infer<typeof AnalyticsCollectionRunIdSchema>
export type AnalyticsProductId = z.infer<typeof AnalyticsProductIdSchema>
export type AnalyticsMetricDefinitionId = z.infer<typeof AnalyticsMetricDefinitionIdSchema>
export type AnalyticsMetricUnit = z.infer<typeof AnalyticsMetricUnitSchema>
export type AnalyticsWindow = z.infer<typeof AnalyticsWindowSchema>
export type AnalyticsCapability = z.infer<typeof AnalyticsCapabilitySchema>

export const AnalyticsMetricDefinitionFixtureSchema = z
  .object({
    metricDefinitionId: AnalyticsMetricDefinitionIdSchema,
    version: z.number().int().positive(),
    unit: AnalyticsMetricUnitSchema,
    window: AnalyticsWindowSchema,
    capability: AnalyticsCapabilitySchema,
  })
  .strict()
  .readonly()

export type AnalyticsMetricDefinition = z.infer<typeof AnalyticsMetricDefinitionFixtureSchema>

const AnalyticsSnapshotBaseSchema = z
  .object({
    organizationId: OrganizationIdSchema,
    shopId: ShopIdSchema,
    productId: AnalyticsProductIdSchema,
    definition: AnalyticsMetricDefinitionFixtureSchema,
    collectedAt: AnalyticsTimestampSchema,
    asOf: AnalyticsTimestampSchema,
  })
  .strict()

export const AnalyticsSnapshotFixtureSchema = z
  .discriminatedUnion("state", [
    AnalyticsSnapshotBaseSchema.extend({ state: z.literal("value"), value: z.number().finite().nonnegative() }),
    AnalyticsSnapshotBaseSchema.extend({ state: z.literal("missing") }),
    AnalyticsSnapshotBaseSchema.extend({ state: z.literal("unsupported") }),
    AnalyticsSnapshotBaseSchema.extend({ state: z.literal("not_returned") }),
  ])
  .superRefine((snapshot, context) => {
    switch (snapshot.state) {
      case "unsupported":
        if (snapshot.definition.capability !== "unsupported") {
          context.addIssue({ code: "custom", message: "unsupported state requires unsupported capability" })
        }
        return
      case "value":
      case "missing":
      case "not_returned":
        if (snapshot.definition.capability !== "enabled") {
          context.addIssue({ code: "custom", message: "supported snapshot state requires enabled capability" })
        }
        return
      default:
        return assertNever(snapshot)
    }
  })

export type AnalyticsSnapshotFixture = z.infer<typeof AnalyticsSnapshotFixtureSchema>
export type AnalyticsSnapshot = AnalyticsSnapshotFixture & {
  readonly collectionRunId: AnalyticsCollectionRunId
}

export type AnalyticsCollectionRun = {
  readonly collectionRunId: AnalyticsCollectionRunId
  readonly organizationId: OrganizationId
  readonly shopId: ShopId
  readonly definition: AnalyticsMetricDefinition
  readonly requestedProductIds: readonly AnalyticsProductId[]
  readonly startedAt: string
  readonly finishedAt: string
  readonly expectedPages: number
  readonly observedPages: number
  readonly status: "complete" | "partial" | "failed"
}

export type AnalyticsCollection = {
  readonly run: AnalyticsCollectionRun
  readonly snapshots: readonly AnalyticsSnapshot[]
}

export type AnalyticsMetricProjection =
  | { readonly kind: "value"; readonly value: number; readonly unit: AnalyticsMetricUnit; readonly window: AnalyticsWindow }
  | { readonly kind: "missing" }
  | { readonly kind: "unsupported"; readonly capability: AnalyticsCapability }
  | { readonly kind: "not_returned" }
  | { readonly kind: "stale"; readonly asOf: string }

export type AnalyticsComparisonDecision =
  | { readonly kind: "eligible"; readonly delta: number; readonly unit: AnalyticsMetricUnit; readonly window: AnalyticsWindow }
  | {
      readonly kind: "ineligible"
      readonly reason: "collection_incomplete" | "metric_incompatible" | "metric_absent" | "snapshot_stale"
    }

function assertNever(value: never): never {
  throw new TypeError(`Unhandled analytics snapshot state: ${String(value)}`)
}
