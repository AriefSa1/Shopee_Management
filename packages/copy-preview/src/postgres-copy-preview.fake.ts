import type { PostgresExecutor, SqlRow, SqlStatement } from "../../delivery/src/postgres-delivery.ts"
type State = { previews: Map<string, SqlRow>; intents: Map<string, SqlRow> }
const key = (...parts: string[]) => parts.join(":")
const str = (s: SqlStatement, i: number) => { const value = s.params[i]; if (typeof value !== "string") throw new Error(`expected string parameter ${i}`); return value }
const rowString = (row: SqlRow, name: string): string => { const value = row[name]; if (typeof value !== "string") throw new Error(`expected string row value ${name}`); return value }
export class FakeCopyPreviewPostgresExecutor implements PostgresExecutor {
  readonly statements: SqlStatement[] = []; private readonly state: State
  constructor(state?: State) { this.state = state ?? { previews: new Map(), intents: new Map() } }
  async transaction<T>(work: (executor: PostgresExecutor) => Promise<T>): Promise<T> { const child = new FakeCopyPreviewPostgresExecutor({ previews: new Map(this.state.previews), intents: new Map(this.state.intents) }); const result = await work(child); this.state.previews.clear(); child.state.previews.forEach((v,k)=>this.state.previews.set(k,v)); this.state.intents.clear(); child.state.intents.forEach((v,k)=>this.state.intents.set(k,v)); this.statements.push(...child.statements); return result }
  async query(statement: SqlStatement): Promise<readonly SqlRow[]> {
    this.statements.push(statement)
    if (statement.name === "copy.preview.insert") {
      const row = { organization_id: str(statement, 0), preview_hash: str(statement, 1), source_snapshot_id: str(statement, 2), requirement_snapshot_id: str(statement, 3), destination_shop_id: str(statement, 4), kind: str(statement, 5), title: statement.params[6], description: statement.params[7], category_id: statement.params[8], attributes: statement.params[9], errors: statement.params[10] }
      this.state.previews.set(key(row.organization_id, row.preview_hash), row)
      return []
    }
    if (statement.name === "copy.intent.insert") {
      const row = { organization_id: str(statement, 0), copy_intent_id: str(statement, 1), source_snapshot_id: str(statement, 2), destination_shop_id: str(statement, 3), active_preview_hash: str(statement, 4), command_version: statement.params[5] ?? null, serialization_generation: statement.params[6] ?? null }
      this.state.intents.set(key(row.organization_id, row.copy_intent_id), row)
      return []
    }
    if (statement.name === "copy.intent.read") {
      const organizationId = str(statement, 0)
      const destinationShopId = str(statement, 1)
      const intentId = str(statement, 2)
      const intent = this.state.intents.get(key(organizationId, intentId))
      if (intent === undefined || rowString(intent, "destination_shop_id") !== destinationShopId) return []
      const activePreviewHash = rowString(intent, "active_preview_hash")
      const preview = this.state.previews.get(key(organizationId, activePreviewHash))
      return preview === undefined ? [] : [{ ...intent, ...preview, active_preview_hash: activePreviewHash }]
    }
    throw new Error(`Unhandled fake statement ${statement.name}`)
  }
}
