import type { PostgresExecutor, SqlRow, SqlStatement } from "../../delivery/src/postgres-delivery.ts"

type State = { commands: Map<string, SqlRow>; attempts: Map<string, SqlRow>; externalOperations: Map<string, SqlRow> }
const key = (...parts: string[]) => parts.join(":")
const str = (s: SqlStatement, i: number) => { const value = s.params[i]; if (typeof value !== "string") throw new Error(`expected string parameter ${i}`); return value }

export class FakeWriteRecoveryPostgresExecutor implements PostgresExecutor {
  readonly statements: SqlStatement[] = []
  private readonly state: State
  constructor(state?: State) { this.state = state ?? { commands: new Map(), attempts: new Map(), externalOperations: new Map() } }
  async transaction<T>(work: (executor: PostgresExecutor) => Promise<T>): Promise<T> {
    const child = new FakeWriteRecoveryPostgresExecutor({ commands: new Map(this.state.commands), attempts: new Map(this.state.attempts), externalOperations: new Map(this.state.externalOperations) })
    const result = await work(child)
    this.state.commands.clear(); child.state.commands.forEach((value, entryKey) => { this.state.commands.set(entryKey, value) })
    this.state.attempts.clear(); child.state.attempts.forEach((value, entryKey) => { this.state.attempts.set(entryKey, value) })
    this.state.externalOperations.clear(); child.state.externalOperations.forEach((value, entryKey) => { this.state.externalOperations.set(entryKey, value) })
    this.statements.push(...child.statements)
    return result
  }
  async query(statement: SqlStatement): Promise<readonly SqlRow[]> {
    this.statements.push(statement)
    if (statement.name === "write.command.insert") {
      const row = { organization_id: str(statement, 0), command_id: str(statement, 1), capability_status: str(statement, 6), capability_evidence: str(statement, 7), confirmation_binding: str(statement, 8), plan_kind: str(statement, 9) }
      this.state.commands.set(key(row.organization_id, row.command_id), row); return []
    }
    if (statement.name === "write.attempt.insert") {
      const row = { organization_id: str(statement, 0), attempt_id: str(statement, 1), command_id: str(statement, 2), destination_shop_id: str(statement, 3), payload_hash: str(statement, 4), state: str(statement, 5), dispatch_allowed: statement.params[6] ?? null, confirmation_binding: str(statement, 7), outcome_reason: statement.params[8] ?? null, provider_reference: statement.params[9] ?? null }
      this.state.attempts.set(key(row.organization_id, row.attempt_id), row); return []
    }
    if (statement.name === "write.recovery_decision.insert") return []
    if (statement.name === "external.operation.insert") {
      const row = { organization_id: str(statement, 0), operation_attempt_id: str(statement, 1), write_attempt_id: str(statement, 2), destination_shop_id: str(statement, 3), step: str(statement, 4), request_fingerprint: str(statement, 5), state: str(statement, 6), retry_allowed: statement.params[7] ?? null, outcome_reason: statement.params[8] ?? null, provider_reference: statement.params[9] ?? null }
      this.state.externalOperations.set(key(row.organization_id, row.operation_attempt_id), row); return []
    }
    if (statement.name === "external.operation.read") {
      const row = this.state.externalOperations.get(key(str(statement, 0), str(statement, 1)))
      return row === undefined ? [] : [row]
    }
    if (statement.name === "external.operation.update") {
      const organizationId = str(statement, 4); const operationAttemptId = str(statement, 5); const expectedState = str(statement, 6)
      const current = this.state.externalOperations.get(key(organizationId, operationAttemptId))
      if (current === undefined || current.state !== expectedState) return []
      this.state.externalOperations.set(key(organizationId, operationAttemptId), { ...current, state: str(statement, 0), retry_allowed: statement.params[1] ?? null, outcome_reason: statement.params[2] ?? null, provider_reference: statement.params[3] ?? null }); return [{ operation_attempt_id: operationAttemptId }]
    }
    if (statement.name === "write.attempt.update") {
      const organizationId = str(statement, 4); const attemptId = str(statement, 5); const expectedState = statement.text.includes("state = 'outcome_unknown'") ? "outcome_unknown" : str(statement, 7); const current = this.state.attempts.get(key(organizationId, attemptId))
      if (current === undefined) return []
      if (current.state !== expectedState) return []
      this.state.attempts.set(key(organizationId, attemptId), { ...current, state: str(statement, 0), dispatch_allowed: statement.params[1] ?? null, outcome_reason: statement.params[2] ?? null, provider_reference: statement.params[3] ?? null }); return [{ attempt_id: attemptId }]
    }
    if (statement.name === "write.plan.read") {
      const organizationId = str(statement, 0); const commandId = str(statement, 1); const stored = this.state.commands.get(key(organizationId, commandId)); if (stored === undefined) return []
      const attempts = [...this.state.attempts.values()].filter((row) => row.organization_id === organizationId && row.command_id === commandId)
      return attempts.length === 0 ? [{ ...stored, command_id: commandId, attempt_id: null }] : attempts.map((row) => ({ ...stored, command_id: commandId, ...row, attempt_confirmation_binding: row.confirmation_binding }))
    }
    throw new Error(`Unhandled fake statement ${statement.name}`)
  }
}
