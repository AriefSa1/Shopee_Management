import type { PostgresExecutor, SqlRow, SqlStatement } from "../../delivery/src/postgres-delivery.ts"

type StoredCredential = Map<string, SqlRow>
type StoredBinding = Map<string, SqlRow>

function subjectKey(organizationId: string, subjectId: string): string { return `${organizationId}:${subjectId}` }
function bindingKey(organizationId: string, shopId: string, subjectId: string): string { return `${organizationId}:${shopId}:${subjectId}` }
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

export class FakeOAuthCredentialPostgresExecutor implements PostgresExecutor {
  readonly statements: SqlStatement[] = []
  private readonly subjects: StoredCredential
  private readonly bindings: StoredBinding
  private readonly transactionTail: { current: Promise<void> }

  constructor(subjects?: StoredCredential, bindings?: StoredBinding, transactionTail?: { current: Promise<void> }) {
    this.subjects = subjects ?? new Map()
    this.bindings = bindings ?? new Map()
    this.transactionTail = transactionTail ?? { current: Promise.resolve() }
  }

  statementsFor(name: string): readonly SqlStatement[] { return this.statements.filter((statement) => statement.name === name) }
  bindingRows(): readonly SqlRow[] { return [...this.bindings.values()] }

  async transaction<T>(work: (executor: PostgresExecutor) => Promise<T>): Promise<T> {
    const previous = this.transactionTail.current
    let release: (() => void) | undefined
    this.transactionTail.current = new Promise<void>((resolve) => { release = resolve })
    await previous
    const child = new FakeOAuthCredentialPostgresExecutor(new Map(this.subjects), new Map(this.bindings))
    child.transactionTail.current = this.transactionTail.current
    try {
      const result = await work(child)
      this.subjects.clear(); for (const [key, row] of child.subjects) this.subjects.set(key, row)
      this.bindings.clear(); for (const [key, row] of child.bindings) this.bindings.set(key, row)
      this.statements.push(...child.statements)
      return result
    } finally {
      release?.()
    }
  }

  async query(statement: SqlStatement): Promise<readonly SqlRow[]> {
    this.statements.push(statement)
    const organizationId = stringParam(statement, 0)
    const subjectId = stringParam(statement, 1)
    const key = subjectKey(organizationId, subjectId)
    if (statement.name === "oauth.credential_subject.insert") {
      this.subjects.set(key, {
        organization_id: organizationId, credential_subject_id: subjectId,
        partner_application_id: stringParam(statement, 2), revision: numberParam(statement, 3),
        key_version: numberParam(statement, 4), envelope_algorithm: stringParam(statement, 5),
        envelope_ciphertext: stringParam(statement, 6), expires_at: stringParam(statement, 7), status: stringParam(statement, 8),
      }); return []
    }
    if (statement.name === "oauth.credential_subject.bind.lock") {
      const row = this.subjects.get(key)
      if (row === undefined) return []
      return [{
        credential_status: row["status"],
        credential_partner_application_id: row["partner_application_id"],
        shop_status: "active",
        shop_partner_application_id: row["partner_application_id"],
        shop_market: "ID",
      }]
    }
    if (statement.name === "oauth.credential_subject.refresh.lock") {
      const row = this.subjects.get(key); return row === undefined ? [] : [row]
    }
    if (statement.name === "oauth.credential_subject.binding.insert") {
      const shopId = stringParam(statement, 1)
      const credentialSubjectId = stringParam(statement, 2)
      this.bindings.set(bindingKey(organizationId, shopId, credentialSubjectId), {
        organization_id: organizationId, shop_id: shopId, credential_subject_id: credentialSubjectId, status: stringParam(statement, 3),
      }); return []
    }
    if (statement.name === "oauth.credential_subject.outcome_unknown") {
      const row = this.subjects.get(key); if (row !== undefined) this.subjects.set(key, { ...row, status: "reauth_required" }); return []
    }
    if (statement.name === "oauth.credential_subject.bindings.reauth") {
      for (const [entryKey, row] of this.bindings) if (row["organization_id"] === organizationId && row["credential_subject_id"] === subjectId && row["status"] === "active") this.bindings.set(entryKey, { ...row, status: "reauth_required" }); return []
    }
    if (statement.name === "oauth.credential_subject.rotate") {
      const row = this.subjects.get(key); if (row !== undefined) this.subjects.set(key, { ...row, revision: numberParam(statement, 2), key_version: numberParam(statement, 3), envelope_algorithm: stringParam(statement, 4), envelope_ciphertext: stringParam(statement, 5), status: "active", ...(typeof statement.params[7] === "string" ? { expires_at: statement.params[7] } : {}) }); return []
    }
    if (statement.name === "oauth.credential_subject.envelope.read") {
      const row = this.subjects.get(key); return row === undefined ? [] : [row]
    }
    throw new Error(`Unhandled fake statement: ${statement.name}`)
  }
}
