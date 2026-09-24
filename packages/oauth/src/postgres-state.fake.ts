import type { PostgresExecutor, SqlRow, SqlStatement } from "../../delivery/src/postgres-delivery.ts"

type StoredState = Map<string, SqlRow>

function key(organizationId: string, stateHash: string): string {
  return `${organizationId}:${stateHash}`
}

function stringParam(statement: SqlStatement, index: number): string {
  const value = statement.params[index]
  if (typeof value !== "string") throw new Error(`Expected string parameter at ${index}`)
  return value
}

export class FakeOAuthStatePostgresExecutor implements PostgresExecutor {
  readonly statements: SqlStatement[] = []
  private readonly state: StoredState

  constructor(state?: StoredState) {
    this.state = state ?? new Map()
  }

  statementsFor(name: string): readonly SqlStatement[] {
    return this.statements.filter((statement) => statement.name === name)
  }

  async transaction<T>(work: (executor: PostgresExecutor) => Promise<T>): Promise<T> {
    const child = new FakeOAuthStatePostgresExecutor(new Map(this.state))
    const result = await work(child)
    this.state.clear()
    for (const [entryKey, row] of child.state) this.state.set(entryKey, row)
    this.statements.push(...child.statements)
    return result
  }

  async query(statement: SqlStatement): Promise<readonly SqlRow[]> {
    this.statements.push(statement)
    const organizationId = stringParam(statement, 0)
    const stateHash = stringParam(statement, 1)
    const stateKey = key(organizationId, stateHash)
    if (statement.name === "oauth.state.insert") {
      this.state.set(stateKey, {
        organization_id: organizationId,
        state_hash: stateHash,
        attempt_id: stringParam(statement, 2),
        actor_issuer: stringParam(statement, 3),
        actor_subject: stringParam(statement, 4),
        partner_application_id: stringParam(statement, 5),
        market: stringParam(statement, 6),
        issued_at: stringParam(statement, 7),
        expires_at: stringParam(statement, 8),
        status: stringParam(statement, 9),
      })
      return []
    }
    if (statement.name === "oauth.state.get" || statement.name === "oauth.state.claim.lock") {
      const row = this.state.get(stateKey)
      return row === undefined ? [] : [row]
    }
    if (statement.name === "oauth.state.status.update") {
      const row = this.state.get(stateKey)
      if (row !== undefined && row["status"] === "issued") {
        this.state.set(stateKey, { ...row, status: stringParam(statement, 2), claimed_at: stringParam(statement, 3) })
      }
      return []
    }
    throw new Error(`Unhandled fake statement: ${statement.name}`)
  }
}
