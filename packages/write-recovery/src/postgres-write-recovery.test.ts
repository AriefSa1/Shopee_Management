import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { createWritePlan, ExternalOperationAttemptIdSchema, type WritePlanInput } from "./index.ts"
import { OrganizationIdSchema, ShopIdSchema, WriteHashSchema } from "./model.ts"
import { PostgresWriteRecoveryRepository } from "./postgres-write-recovery.ts"
import { FakeWriteRecoveryPostgresExecutor } from "./postgres-write-recovery.fake.ts"
import { readFileSync } from "node:fs"

const input: WritePlanInput = { organizationId: OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001"), actorId: "actor-owner", intentId: "intent:copy-1", previewHash: WriteHashSchema.parse("a".repeat(64)), commandVersion: 1, destinations: [{ shopId: ShopIdSchema.parse("30000000-0000-4000-8000-000000000001"), payloadHash: WriteHashSchema.parse("b".repeat(64)) }] }
const metadata = { actorId: input.actorId, intentId: input.intentId, previewHash: input.previewHash, commandVersion: input.commandVersion }

describe("PostgreSQL write-recovery persistence contract", () => {
  it("round-trips a write-disabled plan without enabling mutation", async () => {
    const repo = new PostgresWriteRecoveryRepository(new FakeWriteRecoveryPostgresExecutor())
    const plan = createWritePlan(input, { status: "unknown", evidence: "not verified" })
    await repo.savePlan({ plan, metadata })
    const read = await repo.readPlan({ organizationId: input.organizationId }, plan.commandId)
    assert.equal(read?.kind, "write_disabled")
    assert.equal(read?.attempts[0]?.dispatchAllowed, false)
  })

  it("persists outcome_unknown and an operator recovery decision", async () => {
    const repo = new PostgresWriteRecoveryRepository(new FakeWriteRecoveryPostgresExecutor())
    const plan = createWritePlan(input, { status: "verified", evidence: "fixture" })
    await repo.savePlan({ plan, metadata })
    const attempt = plan.attempts[0]
    assert.ok(attempt)
    const unknown = { ...attempt, state: "outcome_unknown" as const, dispatchAllowed: false, outcomeReason: "ack_timeout" }
    await repo.updateAttempt({ attempt: unknown, expectedState: "pending" })
    await repo.persistRecoveryDecision({ organizationId: input.organizationId, attempt: { ...unknown, state: "failed", outcomeReason: "operator_failed" }, decision: { kind: "mark_failed", operatorId: input.actorId, decidedAt: "2026-09-09T00:02:00.000Z", reason: "operator_failed" } })
    const read = await repo.readPlan({ organizationId: input.organizationId }, plan.commandId)
    assert.equal(read?.attempts[0]?.state, "failed")
  })

  it("does not reopen a terminal attempt", async () => {
    const repo = new PostgresWriteRecoveryRepository(new FakeWriteRecoveryPostgresExecutor())
    const plan = createWritePlan(input, { status: "verified", evidence: "fixture" })
    await repo.savePlan({ plan, metadata })
    const attempt = plan.attempts[0]
    assert.ok(attempt)
    await repo.updateAttempt({ attempt: { ...attempt, state: "succeeded", dispatchAllowed: false, providerReference: "fixture-reference" }, expectedState: "pending" })
    await assert.rejects(() => repo.updateAttempt({ attempt: { ...attempt, state: "pending", dispatchAllowed: true }, expectedState: "pending" }), /terminal_state/)
  })

  it("fences parent attempt updates on the expected prior state", async () => {
    const repo = new PostgresWriteRecoveryRepository(new FakeWriteRecoveryPostgresExecutor())
    const plan = createWritePlan(input, { status: "verified", evidence: "fixture" })
    await repo.savePlan({ plan, metadata })
    const attempt = plan.attempts[0]
    assert.ok(attempt)
    const unknown = { ...attempt, state: "outcome_unknown" as const, dispatchAllowed: false, outcomeReason: "ack_timeout" }
    await assert.rejects(() => repo.updateAttempt({ attempt: unknown, expectedState: "dispatched" }), /terminal_state/)
  })

  it("keeps migration scope, terminal checks, append-only recovery, and no raw credentials", () => {
    const sql = readFileSync(new URL("../../../db/migrations/0009_write_recovery.sql", import.meta.url), "utf8")
    assert.match(sql, /FOREIGN KEY \(organization_id, destination_shop_id\)/)
    assert.match(sql, /CHECK \(state IN \('pending', 'dispatched'\) OR dispatch_allowed = false\)/)
    assert.match(sql, /write_recovery_decisions_no_update/)
    assert.match(sql, /decision_kind = 'confirm_succeeded'/)
    assert.doesNotMatch(sql, /access_token|refresh_token|callback_code|authorization_header/i)
  })

  it("persists per-step external attempts and fences outcome_unknown retries", async () => {
    const repo = new PostgresWriteRecoveryRepository(new FakeWriteRecoveryPostgresExecutor())
    const plan = createWritePlan(input, { status: "verified", evidence: "fixture" })
    await repo.savePlan({ plan, metadata })
    const writeAttempt = plan.attempts[0]
    assert.ok(writeAttempt)
    const operation = {
      operationAttemptId: ExternalOperationAttemptIdSchema.parse(`external-attempt:${"d".repeat(64)}`),
      organizationId: input.organizationId,
      writeAttemptId: writeAttempt.attemptId,
      destinationShopId: input.destinations[0]?.shopId ?? ShopIdSchema.parse("30000000-0000-4000-8000-000000000001"),
      step: "media_upload" as const,
      requestFingerprint: WriteHashSchema.parse("e".repeat(64)),
      state: "prepared" as const,
      retryAllowed: true,
    }
    await assert.rejects(
      () => repo.saveExternalOperationAttempt({ ...operation, state: "succeeded", retryAllowed: false }),
      /invalid_row/,
    )
    await repo.saveExternalOperationAttempt(operation)
    const prepared = await repo.readExternalOperationAttempt({ organizationId: input.organizationId }, operation.operationAttemptId)
    assert.equal(prepared?.state, "prepared")
    const sent = { ...operation, state: "sent" as const, retryAllowed: false }
    await repo.updateExternalOperationAttempt({ attempt: sent, expectedState: "prepared" })
    const unknown = { ...sent, state: "outcome_unknown" as const }
    await repo.updateExternalOperationAttempt({ attempt: unknown, expectedState: "sent" })
    await assert.rejects(
      () => repo.updateExternalOperationAttempt({ attempt: { ...unknown, state: "sent", retryAllowed: false }, expectedState: "outcome_unknown" }),
      /terminal_state/,
    )
    await repo.updateExternalOperationAttempt({ attempt: { ...unknown, state: "reauth_required", outcomeReason: "reauth_required:owner" }, expectedState: "outcome_unknown" })
    const recovered = await repo.readExternalOperationAttempt({ organizationId: input.organizationId }, operation.operationAttemptId)
    assert.equal(recovered?.state, "reauth_required")
  })

  it("keeps external-operation migration states explicit and secret-free", () => {
    const sql = readFileSync(new URL("../../../db/migrations/0010_external_operation_attempts.sql", import.meta.url), "utf8")
    assert.match(sql, /FOREIGN KEY \(organization_id, write_attempt_id\)/)
    assert.match(sql, /FOREIGN KEY \(organization_id, destination_shop_id\)/)
    assert.match(sql, /CHECK \(state <> 'outcome_unknown' OR provider_reference IS NULL\)/)
    assert.match(sql, /CHECK \(state <> 'succeeded' OR provider_reference IS NOT NULL\)/)
    assert.doesNotMatch(sql, /access_token|refresh_token|callback_code|authorization_header/i)
  })
})
