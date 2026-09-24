import type { PostgresExecutor, SqlRow, SqlStatement } from "../../delivery/src/postgres-delivery.ts"

type State = { runs: Map<string, SqlRow>; products: Map<string, SqlRow>; variants: Map<string, SqlRow> }
const key = (...parts: string[]) => parts.join(":")
const str = (s: SqlStatement, i: number) => { const v = s.params[i]; if (typeof v !== "string") throw new Error(`expected string param ${i}`); return v }

export class FakeCatalogPostgresExecutor implements PostgresExecutor {
  readonly statements: SqlStatement[] = []
  private readonly state: State
  constructor(state?: State) { this.state = state ?? { runs: new Map(), products: new Map(), variants: new Map() } }
  async transaction<T>(work: (executor: PostgresExecutor) => Promise<T>): Promise<T> {
    const child = new FakeCatalogPostgresExecutor({ runs: new Map(this.state.runs), products: new Map(this.state.products), variants: new Map(this.state.variants) })
    const result = await work(child)
    this.state.runs.clear(); child.state.runs.forEach((v, k) => this.state.runs.set(k, v))
    this.state.products.clear(); child.state.products.forEach((v, k) => this.state.products.set(k, v))
    this.state.variants.clear(); child.state.variants.forEach((v, k) => this.state.variants.set(k, v))
    this.statements.push(...child.statements)
    return result
  }
  async query(statement: SqlStatement): Promise<readonly SqlRow[]> {
    this.statements.push(statement)
    if (statement.name === "catalog.collection_run.insert") {
      const run = { collection_run_id: str(statement, 0), organization_id: str(statement, 1), shop_id: str(statement, 2), collected_at: str(statement, 3), completeness: str(statement, 4), incomplete_reason: statement.params[5] }
      this.state.runs.set(run.collection_run_id, run); return []
    }
    if (statement.name === "catalog.product.insert") {
      const row = { collection_run_id: str(statement, 0), organization_id: str(statement, 1), shop_id: str(statement, 2), product_id: str(statement, 3), product_name: str(statement, 4), publication: str(statement, 5), available_stock: statement.params[6] }
      this.state.products.set(key(row.collection_run_id, row.product_id), row); return []
    }
    if (statement.name === "catalog.variant.insert") {
      const row = { collection_run_id: str(statement, 0), product_id: str(statement, 1), organization_id: str(statement, 2), shop_id: str(statement, 3), variant_id: str(statement, 4), variant_name: str(statement, 5), variant_available_stock: statement.params[6] }
      this.state.variants.set(key(row.collection_run_id, row.product_id, row.variant_id), row); return []
    }
    if (statement.name === "catalog.collection.read") {
      const org = str(statement, 0); const shop = str(statement, 1); const runId = str(statement, 2); const run = this.state.runs.get(runId)
      if (run === undefined || run.organization_id !== org || run.shop_id !== shop) return []
      const products = [...this.state.products.values()].filter((p) => p.collection_run_id === runId)
      if (products.length === 0) return [{ ...run, product_id: null, variant_id: null }]
      return products.flatMap((p) => {
        const variants = [...this.state.variants.values()].filter((v) => v.collection_run_id === runId && v.product_id === p.product_id)
        return variants.length === 0 ? [{ ...run, ...p, product_id: p.product_id, variant_id: null }] : variants.map((v) => ({ ...run, ...p, ...v }))
      })
    }
    throw new Error(`Unhandled catalog statement ${statement.name}`)
  }
}
