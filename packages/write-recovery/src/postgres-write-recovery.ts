import { randomUUID } from "node:crypto"
import { z } from "zod"
import {
  CapabilityGateSchema,
  OrganizationIdSchema,
  ShopIdSchema,
  WriteAttemptIdSchema,
  WriteCommandIdSchema,
  WriteHashSchema,
  ExternalOperationAttemptIdSchema,
  ExternalOperationStateSchema,
  ExternalOperationStepSchema,
  type ExternalOperationAttempt,
  type ExternalOperationState,
  type CapabilityGate,
  type OrganizationId,
  type WriteAttempt,
  type WriteAttemptState,
  type WritePlan,
  type RecoveryDecision,
} from "./model.ts"
import type { PostgresExecutor, SqlRow } from "../../delivery/src/postgres-delivery.ts"

export type WriteRecoveryScope = { readonly organizationId: OrganizationId }
export type WriteCommandMetadata = { readonly actorId: string; readonly intentId: string; readonly previewHash: string; readonly commandVersion: number }
export type WritePlanRecord = { readonly plan: WritePlan; readonly metadata: WriteCommandMetadata }

export class WriteRecoveryPersistenceError extends Error {
  readonly name = "WriteRecoveryPersistenceError"
  readonly code: "invalid_row" | "scope_mismatch" | "terminal_state"
  constructor(code: WriteRecoveryPersistenceError["code"]) { super(`Write recovery persistence rejected the request: ${code}`); this.code = code }
}

export class PostgresWriteRecoveryRepository {
  private readonly executor: PostgresExecutor
  constructor(executor: PostgresExecutor) { this.executor = executor }

  savePlan(record: WritePlanRecord): Promise<void> {
    return this.executor.transaction(async (tx) => {
      const plan = record.plan
      const metadata = record.metadata
      const capability = CapabilityGateSchema.parse(plan.capability)
      const commandId = WriteCommandIdSchema.parse(plan.commandId)
      await tx.query({
        name: "write.command.insert",
        text: `INSERT INTO write_commands (organization_id, command_id, actor_id, intent_id, preview_hash, command_version, capability_status, capability_evidence, confirmation_binding, plan_kind) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        params: [plan.attempts[0]?.organizationId ?? null, commandId, metadata.actorId, metadata.intentId, WriteHashSchema.parse(metadata.previewHash), metadata.commandVersion, capability.status, capability.evidence, plan.confirmationBinding, plan.kind],
      })
      for (const attempt of plan.attempts) await this.insertAttempt(tx, attempt)
    })
  }

  async readPlan(scope: WriteRecoveryScope, commandId: string): Promise<WritePlan | null> {
    const parsedCommandId = WriteCommandIdSchema.parse(commandId)
    const rows = await this.executor.query({ name: "write.plan.read", text: `SELECT c.organization_id, c.command_id, c.capability_status, c.capability_evidence, c.confirmation_binding, c.plan_kind, a.attempt_id, a.destination_shop_id, a.payload_hash, a.state, a.dispatch_allowed, a.outcome_reason, a.provider_reference, a.confirmation_binding AS attempt_confirmation_binding FROM write_commands c LEFT JOIN write_attempts a ON a.organization_id = c.organization_id AND a.command_id = c.command_id WHERE c.organization_id = $1 AND c.command_id = $2 ORDER BY a.attempt_id`, params: [scope.organizationId, parsedCommandId] })
    if (rows.length === 0) return null
    return mapPlan(rows)
  }

  updateAttempt(input: { readonly attempt: WriteAttempt; readonly expectedState: Extract<WriteAttemptState, "pending" | "dispatched" | "outcome_unknown"> }): Promise<void> {
    return this.executor.transaction(async (tx) => {
      const attempt = input.attempt
      const updated = await tx.query({ name: "write.attempt.update", text: `UPDATE write_attempts SET state=$1, dispatch_allowed=$2, outcome_reason=$3, provider_reference=$4, updated_at=transaction_timestamp() WHERE organization_id=$5 AND attempt_id=$6 AND command_id=$7 AND state=$8 RETURNING attempt_id`, params: [attempt.state, attempt.dispatchAllowed, attempt.outcomeReason ?? null, attempt.providerReference ?? null, attempt.organizationId, attempt.attemptId, attempt.commandId, input.expectedState] })
      if (updated.length === 0) throw new WriteRecoveryPersistenceError("terminal_state")
    })
  }

  persistRecoveryDecision(input: { readonly organizationId: OrganizationId; readonly attempt: WriteAttempt; readonly decision: RecoveryDecision }): Promise<void> {
    return this.executor.transaction(async (tx) => {
      if (input.attempt.organizationId !== input.organizationId) throw new WriteRecoveryPersistenceError("scope_mismatch")
      await tx.query({ name: "write.recovery_decision.insert", text: `INSERT INTO write_recovery_decisions (decision_id, organization_id, attempt_id, decision_kind, operator_id, decided_at, reason, provider_reference) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, params: [randomUUID(), input.organizationId, input.attempt.attemptId, input.decision.kind, input.decision.operatorId, input.decision.decidedAt, "reason" in input.decision ? input.decision.reason : null, "providerReference" in input.decision ? input.decision.providerReference : null] })
      const updated = await tx.query({ name: "write.attempt.update", text: `UPDATE write_attempts SET state=$1, dispatch_allowed=$2, outcome_reason=$3, provider_reference=$4, updated_at=transaction_timestamp() WHERE organization_id=$5 AND attempt_id=$6 AND command_id=$7 AND state = 'outcome_unknown' RETURNING attempt_id`, params: [input.attempt.state, input.attempt.dispatchAllowed, input.attempt.outcomeReason ?? null, input.attempt.providerReference ?? null, input.organizationId, input.attempt.attemptId, input.attempt.commandId] })
      if (updated.length === 0) throw new WriteRecoveryPersistenceError("terminal_state")
    })
  }

  async saveExternalOperationAttempt(attempt: ExternalOperationAttempt): Promise<void> {
    validateExternalOperationAttempt(attempt)
    await this.executor.transaction(async (tx) => {
      await tx.query({
        name: "external.operation.insert",
        text: `INSERT INTO external_operation_attempts (organization_id, operation_attempt_id, write_attempt_id, destination_shop_id, step, request_fingerprint, state, retry_allowed, outcome_reason, provider_reference) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        params: [attempt.organizationId, attempt.operationAttemptId, attempt.writeAttemptId, attempt.destinationShopId, attempt.step, attempt.requestFingerprint, attempt.state, attempt.retryAllowed, attempt.outcomeReason ?? null, attempt.providerReference ?? null],
      })
    })
  }

  async readExternalOperationAttempt(scope: WriteRecoveryScope, operationAttemptId: string): Promise<ExternalOperationAttempt | null> {
    const parsedId = ExternalOperationAttemptIdSchema.parse(operationAttemptId)
    const rows = await this.executor.query({
      name: "external.operation.read",
      text: `SELECT organization_id, operation_attempt_id, write_attempt_id, destination_shop_id, step, request_fingerprint, state, retry_allowed, outcome_reason, provider_reference FROM external_operation_attempts WHERE organization_id = $1 AND operation_attempt_id = $2`,
      params: [scope.organizationId, parsedId],
    })
    const row = rows[0]
    return row === undefined ? null : mapExternalOperationAttempt(row)
  }

  async updateExternalOperationAttempt(input: { readonly attempt: ExternalOperationAttempt; readonly expectedState: ExternalOperationState }): Promise<void> {
    validateExternalOperationAttempt(input.attempt)
    assertExternalOperationTransition(input.expectedState, input.attempt.state)
    await this.executor.transaction(async (tx) => {
      const updated = await tx.query({
        name: "external.operation.update",
        text: `UPDATE external_operation_attempts SET state=$1, retry_allowed=$2, outcome_reason=$3, provider_reference=$4, updated_at=transaction_timestamp() WHERE organization_id=$5 AND operation_attempt_id=$6 AND state=$7 RETURNING operation_attempt_id`,
        params: [input.attempt.state, input.attempt.retryAllowed, input.attempt.outcomeReason ?? null, input.attempt.providerReference ?? null, input.attempt.organizationId, input.attempt.operationAttemptId, input.expectedState],
      })
      if (updated.length === 0) throw new WriteRecoveryPersistenceError("terminal_state")
    })
  }

  private async insertAttempt(tx: PostgresExecutor, attempt: WriteAttempt): Promise<void> {
    await tx.query({ name: "write.attempt.insert", text: `INSERT INTO write_attempts (organization_id, attempt_id, command_id, destination_shop_id, payload_hash, state, dispatch_allowed, confirmation_binding, outcome_reason, provider_reference) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, params: [attempt.organizationId, attempt.attemptId, attempt.commandId, attempt.destinationShopId, attempt.payloadHash, attempt.state, attempt.dispatchAllowed, attempt.confirmationBinding, attempt.outcomeReason ?? null, attempt.providerReference ?? null] })
  }
}

function mapPlan(rows: readonly SqlRow[]): WritePlan {
  const first = rows[0]; if (first === undefined) throw new WriteRecoveryPersistenceError("invalid_row")
  const organizationId = OrganizationIdSchema.parse(requiredString(first, "organization_id"))
  const capability: CapabilityGate = CapabilityGateSchema.parse({ status: requiredString(first, "capability_status"), evidence: requiredString(first, "capability_evidence") })
  const confirmationBinding = WriteHashSchema.parse(requiredString(first, "confirmation_binding"))
  const attempts: WriteAttempt[] = []
  for (const row of rows) {
    if (row["attempt_id"] === null || row["attempt_id"] === undefined) continue
    const attemptConfirmationBinding = WriteHashSchema.parse(requiredString(row, "attempt_confirmation_binding"))
    attempts.push({
      attemptId: WriteAttemptIdSchema.parse(requiredString(row, "attempt_id")),
      commandId: WriteCommandIdSchema.parse(requiredString(row, "command_id")),
      organizationId,
      destinationShopId: ShopIdSchema.parse(requiredString(row, "destination_shop_id")),
      payloadHash: WriteHashSchema.parse(requiredString(row, "payload_hash")),
      state: z.enum(["pending", "dispatched", "succeeded", "failed", "outcome_unknown", "reauth_required"]).parse(requiredString(row, "state")),
      dispatchAllowed: requiredBoolean(row, "dispatch_allowed"),
      confirmationBinding: attemptConfirmationBinding,
      ...(row["outcome_reason"] === null || row["outcome_reason"] === undefined ? {} : { outcomeReason: requiredString(row, "outcome_reason") }),
      ...(row["provider_reference"] === null || row["provider_reference"] === undefined ? {} : { providerReference: requiredString(row, "provider_reference") }),
    })
  }
  const kind = z.enum(["write_disabled", "ready"]).parse(requiredString(first, "plan_kind"))
  return kind === "ready" ? { kind, commandId: WriteCommandIdSchema.parse(requiredString(first, "command_id")), capability, confirmationBinding, attempts } : { kind, commandId: WriteCommandIdSchema.parse(requiredString(first, "command_id")), capability, confirmationBinding, attempts }
}

function requiredString(row: SqlRow, key: string): string { const value = row[key]; if (typeof value !== "string") throw new WriteRecoveryPersistenceError("invalid_row"); return value }
function requiredBoolean(row: SqlRow, key: string): boolean { const value = row[key]; if (typeof value !== "boolean") throw new WriteRecoveryPersistenceError("invalid_row"); return value }

function mapExternalOperationAttempt(row: SqlRow): ExternalOperationAttempt {
  const operationAttemptId = ExternalOperationAttemptIdSchema.parse(requiredString(row, "operation_attempt_id"))
  const state = ExternalOperationStateSchema.parse(requiredString(row, "state"))
  const retryAllowed = requiredBoolean(row, "retry_allowed")
  const attempt: ExternalOperationAttempt = {
    operationAttemptId,
    organizationId: OrganizationIdSchema.parse(requiredString(row, "organization_id")),
    writeAttemptId: WriteAttemptIdSchema.parse(requiredString(row, "write_attempt_id")),
    destinationShopId: ShopIdSchema.parse(requiredString(row, "destination_shop_id")),
    step: ExternalOperationStepSchema.parse(requiredString(row, "step")),
    requestFingerprint: WriteHashSchema.parse(requiredString(row, "request_fingerprint")),
    state,
    retryAllowed,
    ...(row["outcome_reason"] === null || row["outcome_reason"] === undefined ? {} : { outcomeReason: requiredString(row, "outcome_reason") }),
    ...(row["provider_reference"] === null || row["provider_reference"] === undefined ? {} : { providerReference: requiredString(row, "provider_reference") }),
  }
  validateExternalOperationAttempt(attempt)
  return attempt
}

function validateExternalOperationAttempt(attempt: ExternalOperationAttempt): void {
  if ((attempt.state === "prepared") !== attempt.retryAllowed) throw new WriteRecoveryPersistenceError("invalid_row")
  if (attempt.state === "outcome_unknown" && attempt.providerReference !== undefined) throw new WriteRecoveryPersistenceError("invalid_row")
  if (attempt.state === "succeeded" && attempt.providerReference === undefined) throw new WriteRecoveryPersistenceError("invalid_row")
}

function assertExternalOperationTransition(expected: ExternalOperationState, next: ExternalOperationState): void {
  const allowed: Record<ExternalOperationState, readonly ExternalOperationState[]> = {
    prepared: ["sent", "failed"],
    sent: ["succeeded", "failed", "outcome_unknown"],
    outcome_unknown: ["succeeded", "failed", "reauth_required"],
    succeeded: [],
    failed: [],
    reauth_required: [],
  }
  if (!allowed[expected].includes(next)) throw new WriteRecoveryPersistenceError("terminal_state")
}
