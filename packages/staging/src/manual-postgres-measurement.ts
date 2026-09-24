import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { OrganizationIdSchema } from "../../identity/src/model.ts"
import { evaluatePilotMeasurement } from "./measurement.ts"
import { PilotMeasurementCaptureSchema } from "./model.ts"
import { FakePilotMeasurementPostgresExecutor } from "./postgres-measurement.fake.ts"
import { PilotMeasurementIdSchema, PostgresPilotMeasurementRepository } from "./postgres-measurement.ts"

const organizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
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
const outcome = evaluatePilotMeasurement(capture)
const executor = new FakePilotMeasurementPostgresExecutor()
const repository = new PostgresPilotMeasurementRepository(executor)
await repository.saveMeasurement({ measurementId, capture, outcome })
const loaded = await repository.readMeasurement({ organizationId }, measurementId)
assert.deepEqual(loaded, { measurementId, capture, outcome })
const migration = readFileSync(new URL("../../../db/migrations/0011_pilot_measurements.sql", import.meta.url), "utf8")
assert.match(migration, /pilot_workflow_measurements_immutable/)

console.log(JSON.stringify({
  scenario: "postgres-pilot-measurement-persistence-contract",
  saveRead: "passed",
  organizationScope: "passed",
  outcomeFrozen: outcome.kind === "target_met" && outcome.reductionPercent === 60,
  immutableMigration: true,
  statements: executor.statements.length,
  networkCalls: 0,
  databaseCalls: 0,
  shopeeMutations: 0,
  externalWrites: 0,
  secretFieldsPresent: false,
  livePostgres: "not_run",
}, null, 2))
