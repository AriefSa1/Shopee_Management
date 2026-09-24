import type { AnalyticsMetricProjection, AnalyticsSnapshot } from "./model.ts"

export type AnalyticsFreshnessRequest = {
  readonly now: string
  readonly maximumAgeMinutes: number
}

export function projectAnalyticsMetric(
  snapshot: AnalyticsSnapshot,
  freshness: AnalyticsFreshnessRequest,
): AnalyticsMetricProjection {
  switch (snapshot.state) {
    case "value":
      return isStale(snapshot.asOf, freshness)
        ? { kind: "stale", asOf: snapshot.asOf }
        : { kind: "value", value: snapshot.value, unit: snapshot.definition.unit, window: snapshot.definition.window }
    case "missing":
      return { kind: "missing" }
    case "unsupported":
      return { kind: "unsupported", capability: snapshot.definition.capability }
    case "not_returned":
      return { kind: "not_returned" }
    default:
      return assertNever(snapshot)
  }
}

export function isStale(asOf: string, freshness: AnalyticsFreshnessRequest): boolean {
  const ageMilliseconds = Date.parse(freshness.now) - Date.parse(asOf)
  return ageMilliseconds > freshness.maximumAgeMinutes * 60_000
}

function assertNever(value: never): never {
  throw new AnalyticsProjectionContractError("unexpected_snapshot_state", String(value))
}

class AnalyticsProjectionContractError extends Error {
  readonly name = "AnalyticsProjectionContractError"
  readonly code: "unexpected_snapshot_state"

  constructor(code: "unexpected_snapshot_state", detail: string) {
    super(`Analytics projection received an unsupported snapshot state: ${detail}`)
    this.code = code
  }
}
