import type { PostgresExecutor, SqlRow, SqlStatement } from "../../delivery/src/postgres-delivery.ts"

type StoredSnapshot = {
  readonly flags?: SqlRow
  readonly reconciliation?: SqlRow
}

type StoredState = Map<string, StoredSnapshot>

function key(organizationId: string, shopId: string): string {
  return `${organizationId}:${shopId}`
}

function stringParam(statement: SqlStatement, index: number): string {
  const value = statement.params[index]
  if (typeof value !== "string") throw new Error(`Expected string parameter at ${index}`)
  return value
}

function cloneState(state: StoredState): StoredState {
  return new Map(
    [...state].map(([entryKey, row]) => {
      const cloned: StoredSnapshot = {
        ...(row.flags === undefined ? {} : { flags: row.flags }),
        ...(row.reconciliation === undefined ? {} : { reconciliation: row.reconciliation }),
      }
      return [entryKey, cloned]
    }),
  )
}

export class FakeStagingPostgresExecutor implements PostgresExecutor {
  readonly statements: SqlStatement[] = []
  private readonly state: StoredState

  constructor(state?: StoredState) {
    this.state = state ?? new Map()
  }

  statementsFor(name: string): readonly SqlStatement[] {
    return this.statements.filter((statement) => statement.name === name)
  }

  async transaction<T>(work: (executor: PostgresExecutor) => Promise<T>): Promise<T> {
    const child = new FakeStagingPostgresExecutor(cloneState(this.state))
    const result = await work(child)
    this.state.clear()
    for (const [entryKey, row] of child.state) this.state.set(entryKey, row)
    this.statements.push(...child.statements)
    return result
  }

  async query(statement: SqlStatement): Promise<readonly SqlRow[]> {
    this.statements.push(statement)
    const organizationId = stringParam(statement, 0)
    const shopId = stringParam(statement, 1)
    const snapshotKey = key(organizationId, shopId)
    const current = this.state.get(snapshotKey) ?? {}
    if (statement.name === "staging.snapshot.upsert_flags") {
      this.state.set(snapshotKey, {
        ...current,
        flags: {
          organization_id: organizationId,
          shop_id: shopId,
          environment: stringParam(statement, 2),
          write_pilot_enabled: statement.params[3] ?? null,
          official_product_write: stringParam(statement, 4),
          media_lifecycle: stringParam(statement, 5),
          item_correlation: stringParam(statement, 6),
          variation_atomicity: stringParam(statement, 7),
          safe_recovery: stringParam(statement, 8),
        },
      })
      return []
    }
    if (statement.name === "staging.snapshot.upsert_reconciliation") {
      this.state.set(snapshotKey, {
        ...current,
        reconciliation: {
          organization_id: organizationId,
          shop_id: shopId,
          collected_at: stringParam(statement, 2),
          status: stringParam(statement, 3),
          expected_destination_count: statement.params[4] ?? null,
          observed_destination_count: statement.params[5] ?? null,
        },
      })
      return []
    }
    if (statement.name === "staging.snapshot.read") {
      if (current.flags === undefined || current.reconciliation === undefined) return []
      return [{ ...current.flags, ...current.reconciliation }]
    }
    throw new Error(`Unhandled fake statement: ${statement.name}`)
  }
}
