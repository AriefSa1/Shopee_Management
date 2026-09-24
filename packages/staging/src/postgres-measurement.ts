import { z } from "zod"
import {
  OrganizationIdSchema,
  type OrganizationId,
} from "../../identity/src/model.ts"
import type { PostgresExecutor, SqlRow } from "../../delivery/src/postgres-delivery.ts"
import { evaluatePilotMeasurement } from "./measurement.ts"
import {
  PilotMeasurementCaptureSchema,
  type PilotMeasurementCapture,
  type PilotMeasurementOutcome,
} from "./model.ts"

export const PilotMeasurementIdSchema = z.string().uuid().brand("PilotMeasurementId")
export type PilotMeasurementId = z.infer<typeof PilotMeasurementIdSchema>

export type PilotMeasurementRecord = {
  readonly measurementId: PilotMeasurementId
  readonly capture: PilotMeasurementCapture
  readonly outcome: PilotMeasurementOutcome
}

export type PilotMeasurementScope = {
  readonly organizationId: OrganizationId
}

export class PilotMeasurementPersistenceError extends Error {
  readonly name = "PilotMeasurementPersistenceError"
  readonly code: "organization_mismatch" | "duplicate_measurement" | "invalid_row" | "outcome_mismatch"

  constructor(code: PilotMeasurementPersistenceError["code"]) {
    super(`Pilot measurement persistence rejected the request: ${code}`)
    this.code = code
  }
}

export class PostgresPilotMeasurementRepository {
  private readonly executor: PostgresExecutor

  constructor(executor: PostgresExecutor) {
    this.executor = executor
  }

  saveMeasurement(input: PilotMeasurementRecord): Promise<void> {
    return this.executor.transaction(async (tx) => {
      const measurementId = PilotMeasurementIdSchema.parse(input.measurementId)
      const capture = PilotMeasurementCaptureSchema.parse(input.capture)
      const expectedOutcome = evaluatePilotMeasurement(capture)
      if (expectedOutcome.kind !== input.outcome.kind || expectedOutcome.reductionPercent !== input.outcome.reductionPercent) {
        throw new PilotMeasurementPersistenceError("outcome_mismatch")
      }
      await tx.query({
        name: "staging.pilot_measurement.insert",
        text: `INSERT INTO pilot_workflow_measurements (
          measurement_id, organization_id, captured_at, workflow,
          baseline_minutes, observed_minutes, sample_count,
          target_reduction_percent, reduction_percent, outcome
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        params: [
          measurementId,
          capture.organizationId,
          capture.capturedAt,
          capture.workflow,
          capture.baselineMinutes,
          capture.observedMinutes,
          capture.sampleCount,
          capture.targetReductionPercent,
          expectedOutcome.reductionPercent,
          expectedOutcome.kind,
        ],
      })
    })
  }

  async readMeasurement(scope: PilotMeasurementScope, measurementId: PilotMeasurementId): Promise<PilotMeasurementRecord | null> {
    const parsedMeasurementId = PilotMeasurementIdSchema.parse(measurementId)
    const rows = await this.executor.query({
      name: "staging.pilot_measurement.read",
      text: `SELECT measurement_id, organization_id, captured_at, workflow,
        baseline_minutes, observed_minutes, sample_count,
        target_reduction_percent, reduction_percent, outcome
      FROM pilot_workflow_measurements
      WHERE organization_id = $1 AND measurement_id = $2`,
      params: [scope.organizationId, parsedMeasurementId],
    })
    const row = rows[0]
    return row === undefined ? null : mapMeasurement(row)
  }
}

function requiredString(row: SqlRow, key: string): string {
  const value = row[key]
  if (typeof value !== "string") throw new PilotMeasurementPersistenceError("invalid_row")
  return value
}

function requiredNumber(row: SqlRow, key: string): number {
  const value = row[key]
  if (typeof value !== "number") throw new PilotMeasurementPersistenceError("invalid_row")
  return value
}

function mapMeasurement(row: SqlRow): PilotMeasurementRecord {
  const organizationId = OrganizationIdSchema.parse(requiredString(row, "organization_id"))
  const capture = PilotMeasurementCaptureSchema.parse({
    organizationId,
    capturedAt: requiredString(row, "captured_at"),
    workflow: requiredString(row, "workflow"),
    baselineMinutes: requiredNumber(row, "baseline_minutes"),
    observedMinutes: requiredNumber(row, "observed_minutes"),
    sampleCount: requiredNumber(row, "sample_count"),
    targetReductionPercent: requiredNumber(row, "target_reduction_percent"),
  })
  const outcome = {
    kind: z.enum(["target_met", "target_missed"]).parse(requiredString(row, "outcome")),
    reductionPercent: requiredNumber(row, "reduction_percent"),
    targetReductionPercent: capture.targetReductionPercent,
  } satisfies PilotMeasurementOutcome
  const expectedOutcome = evaluatePilotMeasurement(capture)
  if (expectedOutcome.kind !== outcome.kind || expectedOutcome.reductionPercent !== outcome.reductionPercent) {
    throw new PilotMeasurementPersistenceError("invalid_row")
  }
  return {
    measurementId: PilotMeasurementIdSchema.parse(requiredString(row, "measurement_id")),
    capture,
    outcome,
  }
}
