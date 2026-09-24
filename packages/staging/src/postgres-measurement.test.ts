import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { OrganizationIdSchema } from "../../identity/src/model.ts"
import { evaluatePilotMeasurement } from "./measurement.ts"
import { PilotMeasurementCaptureSchema } from "./model.ts"
import { FakePilotMeasurementPostgresExecutor } from "./postgres-measurement.fake.ts"
import {
  PilotMeasurementIdSchema,
  PilotMeasurementPersistenceError,
  PostgresPilotMeasurementRepository,
} from "./postgres-measurement.ts"

const organizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
const otherOrganizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000009")
const measurementId = PilotMeasurementIdSchema.parse("80000000-0000-4000-8000-000000000001")
const capture = PilotMeasurementCaptureSchema.parse({
  organizationId,
  capturedAt: "2026-09-10T00:00:00.000Z",
  workflow: "multi_store_product_management",
  baselineMinutes: 30,
  observedMinutes: 12,
  sampleCount: 10,
  targetReductionPercent: 50,
})

describe("PostgreSQL pilot measurement persistence contract", () => {
  it("round-trips an immutable measurement and evaluated outcome", async () => {
    const executor = new FakePilotMeasurementPostgresExecutor()
    const repository = new PostgresPilotMeasurementRepository(executor)
    const outcome = evaluatePilotMeasurement(capture)

    await repository.saveMeasurement({ measurementId, capture, outcome })
    const loaded = await repository.readMeasurement({ organizationId }, measurementId)

    assert.deepEqual(loaded, { measurementId, capture, outcome })
    assert.equal(executor.statementsFor("staging.pilot_measurement.insert").length, 1)
    assert.equal(executor.statementsFor("staging.pilot_measurement.read").length, 1)
  })

  it("does not cross-read another organization", async () => {
    const executor = new FakePilotMeasurementPostgresExecutor()
    const repository = new PostgresPilotMeasurementRepository(executor)
    await repository.saveMeasurement({ measurementId, capture, outcome: evaluatePilotMeasurement(capture) })

    assert.equal(await repository.readMeasurement({ organizationId: otherOrganizationId }, measurementId), null)
  })

  it("rejects a caller-supplied outcome that does not match the frozen capture", async () => {
    const executor = new FakePilotMeasurementPostgresExecutor()
    const repository = new PostgresPilotMeasurementRepository(executor)
    await assert.rejects(
      repository.saveMeasurement({
        measurementId,
        capture,
        outcome: { kind: "target_missed", reductionPercent: 60, targetReductionPercent: 50 },
      }),
      (error: unknown) => error instanceof PilotMeasurementPersistenceError && error.code === "outcome_mismatch",
    )
    assert.equal(executor.statementsFor("staging.pilot_measurement.insert").length, 0)
  })

  it("rejects a duplicate measurement identity", async () => {
    const executor = new FakePilotMeasurementPostgresExecutor()
    const repository = new PostgresPilotMeasurementRepository(executor)
    const input = { measurementId, capture, outcome: evaluatePilotMeasurement(capture) }
    await repository.saveMeasurement(input)
    await assert.rejects(repository.saveMeasurement(input), /duplicate pilot measurement/)
  })

  it("keeps the migration organization-scoped, immutable, and secret-free", () => {
    const migration = readFileSync(new URL("../../../db/migrations/0011_pilot_measurements.sql", import.meta.url), "utf8")
    assert.match(migration, /organization_id uuid NOT NULL REFERENCES organizations/)
    assert.match(migration, /measurement_id uuid PRIMARY KEY/)
    assert.match(migration, /BEFORE UPDATE OR DELETE ON pilot_workflow_measurements/)
    assert.match(migration, /workflow text NOT NULL CHECK/)
    assert.doesNotMatch(migration, /access_token|refresh_token|partner_key|authorization/i)
  })
})
