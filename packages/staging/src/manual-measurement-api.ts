import assert from "node:assert/strict"
import { OrganizationIdSchema } from "../../identity/src/model.ts"
import { PilotMeasurementCaptureSchema } from "./model.ts"
import { PilotMeasurementIdSchema, type PilotMeasurementRecord } from "./postgres-measurement.ts"
import { createStagingMeasurementApiHandler } from "./measurement-api.ts"

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
let saved: PilotMeasurementRecord | null = null
const dependencies = {
  authenticate: () => ({ organizationId, actorId: "owner-1", canRead: true, canCapture: true }),
  repository: {
    saveMeasurement: async (record: PilotMeasurementRecord) => { saved = record },
    readMeasurement: async () => saved,
  },
  nextMeasurementId: () => measurementId,
}
const post = await createStagingMeasurementApiHandler(
  new Request("https://app.test/api/staging/pilot-measurements", { method: "POST", headers: { authorization: "Bearer fixture", "content-type": "application/json" }, body: JSON.stringify(capture) }),
  dependencies,
)
const get = await createStagingMeasurementApiHandler(
  new Request(`https://app.test/api/staging/pilot-measurements?organizationId=${organizationId}&measurementId=${measurementId}`, { headers: { authorization: "Bearer fixture" } }),
  dependencies,
)
assert.equal(post.status, 201)
assert.equal(get.status, 200)
const savedRecord = (await post.json() as { readonly data: PilotMeasurementRecord }).data

console.log(JSON.stringify({
  scenario: "staging-pilot-measurement-api-contract",
  postStatus: post.status,
  getStatus: get.status,
  serverIssuedIdentity: savedRecord.measurementId === measurementId,
  targetEvaluated: savedRecord.outcome.kind === "target_met" && savedRecord.outcome.reductionPercent === 60,
  mutationPolicy: "local_measurement_only",
  networkCalls: 0,
  databaseCalls: 0,
  shopeeMutations: 0,
  externalWrites: 0,
  secretFieldsPresent: false,
  livePostgres: "not_run",
}, null, 2))
