import { isStale } from "./projection.ts"
import type {
  AnalyticsCollectionRun,
  AnalyticsComparisonDecision,
  AnalyticsSnapshot,
} from "./model.ts"

export type CompareAnalyticsSnapshotsInput = {
  readonly left: AnalyticsSnapshot
  readonly leftRun: AnalyticsCollectionRun
  readonly right: AnalyticsSnapshot
  readonly rightRun: AnalyticsCollectionRun
  readonly now: string
  readonly maximumAgeMinutes: number
}

export function compareAnalyticsSnapshots(
  input: CompareAnalyticsSnapshotsInput,
): AnalyticsComparisonDecision {
  if (input.leftRun.status !== "complete" || input.rightRun.status !== "complete") {
    return { kind: "ineligible", reason: "collection_incomplete" }
  }
  if (!sameDefinition(input.left, input.right)) {
    return { kind: "ineligible", reason: "metric_incompatible" }
  }
  if (input.left.state !== "value" || input.right.state !== "value") {
    return { kind: "ineligible", reason: "metric_absent" }
  }
  const freshness = { now: input.now, maximumAgeMinutes: input.maximumAgeMinutes }
  if (isStale(input.left.asOf, freshness) || isStale(input.right.asOf, freshness)) {
    return { kind: "ineligible", reason: "snapshot_stale" }
  }
  return {
    kind: "eligible",
    delta: input.right.value - input.left.value,
    unit: input.left.definition.unit,
    window: input.left.definition.window,
  }
}

function sameDefinition(left: AnalyticsSnapshot, right: AnalyticsSnapshot): boolean {
  return (
    left.organizationId === right.organizationId &&
    left.definition.metricDefinitionId === right.definition.metricDefinitionId &&
    left.definition.version === right.definition.version &&
    left.definition.unit === right.definition.unit &&
    left.definition.window === right.definition.window
  )
}
