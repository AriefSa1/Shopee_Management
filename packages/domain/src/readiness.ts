import type { DatabaseReadiness } from "./health.ts"

export interface DatabaseReadinessProbe {
  check(): Promise<DatabaseReadiness>
}
