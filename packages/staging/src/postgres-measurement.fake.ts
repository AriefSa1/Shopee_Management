import type { PostgresExecutor, SqlRow, SqlStatement } from "../../delivery/src/postgres-delivery.ts"

type StoredState = Map<string, SqlRow>

function key(organizationId: string, measurementId: string): string {
  return `${organizationId}:${measurementId}`
}

function stringParam(statement: SqlStatement, index: number): string {
  const value = statement.params[index]
  if (typeof value !== "string") throw new Error(`Expected string parameter at ${index}`)
  return value
}

function cloneState(state: StoredState): StoredState {
  return new Map([...state].map(([entryKey, row]) => [entryKey, { ...row }]))
}

export class FakePilotMeasurementPostgresExecutor implements PostgresExecutor {
  readonly statements: SqlStatement[] = []
  private readonly state: StoredState

  constructor(state?: StoredState) {
    this.state = state ?? new Map()
  }

  statementsFor(name: string): readonly SqlStatement[] {
    return this.statements.filter((statement) => statement.name === name)
  }

  async transaction<T>(work: (executor: PostgresExecutor) => Promise<T>): Promise<T> {
    const child = new FakePilotMeasurementPostgresExecutor(cloneState(this.state))
    const result = await work(child)
    this.state.clear()
    for (const [entryKey, row] of child.state) this.state.set(entryKey, row)
    this.statements.push(...child.statements)
    return result
  }

  async query(statement: SqlStatement): Promise<readonly SqlRow[]> {
    this.statements.push(statement)
    if (statement.name === "staging.pilot_measurement.insert") {
      const organizationId = stringParam(statement, 1)
      const measurementId = stringParam(statement, 0)
      const entryKey = key(organizationId, measurementId)
      if (this.state.has(entryKey)) throw new Error("duplicate pilot measurement")
      this.state.set(entryKey, {
        measurement_id: measurementId,
        organization_id: organizationId,
        captured_at: stringParam(statement, 2),
        workflow: stringParam(statement, 3),
        baseline_minutes: statement.params[4] ?? null,
        observed_minutes: statement.params[5] ?? null,
        sample_count: statement.params[6] ?? null,
        target_reduction_percent: statement.params[7] ?? null,
        reduction_percent: statement.params[8] ?? null,
        outcome: stringParam(statement, 9),
      })
      return []
    }
    if (statement.name === "staging.pilot_measurement.read") {
      const row = this.state.get(key(stringParam(statement, 0), stringParam(statement, 1)))
      return row === undefined ? [] : [row]
    }
    throw new Error(`Unhandled fake statement: ${statement.name}`)
  }
}
