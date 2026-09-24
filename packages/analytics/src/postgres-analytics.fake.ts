import type { PostgresExecutor, SqlRow, SqlStatement } from "../../delivery/src/postgres-delivery.ts"

type State = { runs: Map<string, SqlRow>; snapshots: Map<string, SqlRow> }
const key = (...parts: string[]) => parts.join(":")
const str = (statement: SqlStatement, index: number): string => {
  const value = statement.params[index]
  if (typeof value !== "string") throw new Error(`Expected string parameter at ${index}`)
  return value
}

export class FakeAnalyticsPostgresExecutor implements PostgresExecutor {
  readonly statements: SqlStatement[] = []
  private readonly state: State
  constructor(state?: State) { this.state = state ?? { runs: new Map(), snapshots: new Map() } }
  async transaction<T>(work: (executor: PostgresExecutor) => Promise<T>): Promise<T> {
    const child = new FakeAnalyticsPostgresExecutor({ runs: new Map(this.state.runs), snapshots: new Map(this.state.snapshots) })
    const result = await work(child)
    this.state.runs.clear(); child.state.runs.forEach((row, entryKey) => this.state.runs.set(entryKey, row))
    this.state.snapshots.clear(); child.state.snapshots.forEach((row, entryKey) => this.state.snapshots.set(entryKey, row))
    this.statements.push(...child.statements)
    return result
  }
  async query(statement: SqlStatement): Promise<readonly SqlRow[]> {
    this.statements.push(statement)
    if (statement.name === "analytics.collection_run.insert") {
      const run = { collection_run_id: str(statement, 0), organization_id: str(statement, 1), shop_id: str(statement, 2), run_metric_definition_id: str(statement, 3), run_metric_version: statement.params[4] ?? null, run_metric_unit: str(statement, 5), run_metric_window: str(statement, 6), run_metric_capability: str(statement, 7), requested_product_ids: str(statement, 8), started_at: str(statement, 9), finished_at: str(statement, 10), as_of_min: statement.params[11] ?? null, as_of_max: statement.params[12] ?? null, freshness_tolerance_minutes: statement.params[13] ?? null, expected_pages: statement.params[14] ?? null, observed_pages: statement.params[15] ?? null, expected_items: statement.params[16] ?? null, observed_items: statement.params[17] ?? null, cursor_evidence: str(statement, 18), status: str(statement, 19) }
      this.state.runs.set(key(run.organization_id, run.shop_id, run.collection_run_id), run); return []
    }
    if (statement.name === "analytics.metric_snapshot.insert") {
      const row = { collection_run_id: str(statement, 0), organization_id: str(statement, 1), shop_id: str(statement, 2), product_id: str(statement, 3), metric_definition_id: str(statement, 4), metric_version: statement.params[5] ?? null, metric_unit: str(statement, 6), metric_window: str(statement, 7), metric_capability: str(statement, 8), state: str(statement, 9), value: statement.params[10] ?? null, collected_at: str(statement, 11), as_of: str(statement, 12) }
      this.state.snapshots.set(key(row.organization_id, row.shop_id, row.collection_run_id, row.product_id), row); return []
    }
    if (statement.name === "analytics.collection.read") {
      const org = str(statement, 0); const shop = str(statement, 1); const runId = str(statement, 2)
      const run = this.state.runs.get(key(org, shop, runId)); if (run === undefined) return []
      const snapshots = [...this.state.snapshots.values()].filter((row) => row.organization_id === org && row.shop_id === shop && row.collection_run_id === runId)
      return snapshots.length === 0 ? [{ ...run, product_id: null }] : snapshots.map((row) => ({ ...run, ...row }))
    }
    throw new Error(`Unhandled fake statement: ${statement.name}`)
  }
}
