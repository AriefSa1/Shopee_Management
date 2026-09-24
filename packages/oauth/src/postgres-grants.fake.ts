import type { PostgresExecutor, SqlRow, SqlStatement } from "../../delivery/src/postgres-delivery.ts"

type StoredGrant = Map<string, SqlRow>
type StoredSubject = Map<string, SqlRow>
type StoredShop = Map<string, SqlRow>

function grantKey(organizationId: string, grantId: string): string { return `${organizationId}:${grantId}` }
function subjectKey(organizationId: string, grantId: string, subjectId: string): string { return `${organizationId}:${grantId}:${subjectId}` }
function shopKey(organizationId: string, grantId: string, subjectId: string, shopId: string): string { return `${organizationId}:${grantId}:${subjectId}:${shopId}` }
function stringParam(statement: SqlStatement, index: number): string {
  const value = statement.params[index]
  if (typeof value !== "string") throw new Error(`Expected string parameter at ${index}`)
  return value
}
function numberParam(statement: SqlStatement, index: number): number {
  const value = statement.params[index]
  if (typeof value !== "number") throw new Error(`Expected number parameter at ${index}`)
  return value
}

export class FakeOAuthGrantPostgresExecutor implements PostgresExecutor {
  readonly statements: SqlStatement[] = []
  private readonly grants: StoredGrant
  private readonly subjects: StoredSubject
  private readonly shops: StoredShop

  constructor(grants?: StoredGrant, subjects?: StoredSubject, shops?: StoredShop) {
    this.grants = grants ?? new Map()
    this.subjects = subjects ?? new Map()
    this.shops = shops ?? new Map()
  }

  statementsFor(name: string): readonly SqlStatement[] { return this.statements.filter((statement) => statement.name === name) }

  async transaction<T>(work: (executor: PostgresExecutor) => Promise<T>): Promise<T> {
    const child = new FakeOAuthGrantPostgresExecutor(new Map(this.grants), new Map(this.subjects), new Map(this.shops))
    const result = await work(child)
    this.grants.clear(); for (const [key, row] of child.grants) this.grants.set(key, row)
    this.subjects.clear(); for (const [key, row] of child.subjects) this.subjects.set(key, row)
    this.shops.clear(); for (const [key, row] of child.shops) this.shops.set(key, row)
    this.statements.push(...child.statements)
    return result
  }

  async query(statement: SqlStatement): Promise<readonly SqlRow[]> {
    this.statements.push(statement)
    if (statement.name === "oauth.grant.insert") {
      this.grants.set(grantKey(stringParam(statement, 0), stringParam(statement, 1)), {
        organization_id: stringParam(statement, 0), grant_id: stringParam(statement, 1), partner_application_id: stringParam(statement, 2), grant_kind: stringParam(statement, 3), granted_at: stringParam(statement, 4),
      })
      return []
    }
    if (statement.name === "oauth.grant.subject.insert") {
      this.subjects.set(subjectKey(stringParam(statement, 0), stringParam(statement, 1), stringParam(statement, 2)), {
        organization_id: stringParam(statement, 0), grant_id: stringParam(statement, 1), credential_subject_id: stringParam(statement, 2), revision: numberParam(statement, 3), key_version: numberParam(statement, 4),
      })
      return []
    }
    if (statement.name === "oauth.grant.subject.shop.insert") {
      this.shops.set(shopKey(stringParam(statement, 0), stringParam(statement, 1), stringParam(statement, 2), stringParam(statement, 3)), {
        organization_id: stringParam(statement, 0), grant_id: stringParam(statement, 1), credential_subject_id: stringParam(statement, 2), shop_id: stringParam(statement, 3),
      })
      return []
    }
    if (statement.name === "oauth.grant.read") {
      const organizationId = stringParam(statement, 0)
      const grantId = stringParam(statement, 1)
      if (!this.grants.has(grantKey(organizationId, grantId))) return []
      const rows: SqlRow[] = []
      for (const subject of this.subjects.values()) {
        if (subject["organization_id"] !== organizationId || subject["grant_id"] !== grantId) continue
        const subjectIdValue = subject["credential_subject_id"]
        if (typeof subjectIdValue !== "string") continue
        const subjectId = subjectIdValue
        const subjectShops = [...this.shops.values()].filter((shop) => shop["organization_id"] === organizationId && shop["grant_id"] === grantId && shop["credential_subject_id"] === subjectId)
        const grant = this.grants.get(grantKey(organizationId, grantId))
        if (grant === undefined) continue
        const base = { ...grant, ...subject }
        if (subjectShops.length === 0) rows.push({ ...base, shop_id: null })
        else for (const shop of subjectShops) rows.push({ ...base, shop_id: shop["shop_id"] ?? null })
      }
      return rows
    }
    throw new Error(`Unhandled fake statement: ${statement.name}`)
  }
}
