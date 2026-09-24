import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { OrganizationIdSchema } from "../../identity/src/model.ts"
import { PilotMeasurementCaptureSchema } from "./model.ts"
import { PilotMeasurementIdSchema, type PilotMeasurementRecord } from "./postgres-measurement.ts"
import { createStagingMeasurementApiHandler, type StagingMeasurementApiDependencies } from "./measurement-api.ts"

const organizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
const foreignOrganizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000009")
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
const record: PilotMeasurementRecord = {
  measurementId,
  capture,
  outcome: { kind: "target_met", reductionPercent: 60, targetReductionPercent: 50 },
}

function dependencies(overrides: Partial<StagingMeasurementApiDependencies> = {}): StagingMeasurementApiDependencies {
  return {
    authenticate: () => ({ organizationId, actorId: "owner-1", canRead: true, canCapture: true }),
    repository: {
      saveMeasurement: async () => undefined,
      readMeasurement: async () => record,
    },
    nextMeasurementId: () => measurementId,
    ...overrides,
  }
}

describe("staging pilot measurement API boundary", () => {
  it("rejects unauthenticated requests before reading or writing", async () => {
    let calls = 0
    const response = await createStagingMeasurementApiHandler(
      new Request("https://app.test/api/staging/pilot-measurements"),
      dependencies({ authenticate: () => null, repository: { saveMeasurement: async () => { calls += 1 }, readMeasurement: async () => { calls += 1; return record } } }),
    )
    assert.equal(response.status, 401)
    assert.equal(calls, 0)
  })

  it("captures a measurement with a server-issued identity and evaluated outcome", async () => {
    let saved: PilotMeasurementRecord | null = null
    const response = await createStagingMeasurementApiHandler(
      new Request("https://app.test/api/staging/pilot-measurements", { method: "POST", headers: { authorization: "Bearer fixture", "content-type": "application/json" }, body: JSON.stringify(capture) }),
      dependencies({ repository: { saveMeasurement: async (input) => { saved = input }, readMeasurement: async () => record } }),
    )
    assert.equal(response.status, 201)
    assert.deepEqual((await response.json() as { data: PilotMeasurementRecord }).data, record)
    assert.deepEqual(saved, record)
  })

  it("rejects a pilot target below 50 percent at the API boundary", async () => {
    const response = await createStagingMeasurementApiHandler(
      new Request("https://app.test/api/staging/pilot-measurements", { method: "POST", headers: { authorization: "Bearer fixture", "content-type": "application/json" }, body: JSON.stringify({ ...capture, targetReductionPercent: 49 }) }),
      dependencies(),
    )
    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), { error: { code: "invalid_measurement_request" } })
  })

  it("denies capture without explicit permission", async () => {
    let writes = 0
    const response = await createStagingMeasurementApiHandler(
      new Request("https://app.test/api/staging/pilot-measurements", { method: "POST", headers: { authorization: "Bearer fixture", "content-type": "application/json" }, body: JSON.stringify(capture) }),
      dependencies({ authenticate: () => ({ organizationId, actorId: "staff-1", canRead: true, canCapture: false }), repository: { saveMeasurement: async () => { writes += 1 }, readMeasurement: async () => record } }),
    )
    assert.equal(response.status, 403)
    assert.equal(writes, 0)
  })

  it("rejects a foreign organization before persistence", async () => {
    let writes = 0
    const response = await createStagingMeasurementApiHandler(
      new Request("https://app.test/api/staging/pilot-measurements", { method: "POST", headers: { authorization: "Bearer fixture", "content-type": "application/json" }, body: JSON.stringify({ ...capture, organizationId: foreignOrganizationId }) }),
      dependencies({ repository: { saveMeasurement: async () => { writes += 1 }, readMeasurement: async () => record } }),
    )
    assert.equal(response.status, 403)
    assert.equal(writes, 0)
  })

  it("reads only an authenticated organization measurement", async () => {
    const response = await createStagingMeasurementApiHandler(
      new Request(`https://app.test/api/staging/pilot-measurements?organizationId=${organizationId}&measurementId=${measurementId}`, { headers: { authorization: "Bearer fixture" } }),
      dependencies(),
    )
    assert.equal(response.status, 200)
    assert.deepEqual((await response.json() as { data: PilotMeasurementRecord }).data, record)
  })

  it("maps persistence failures to a safe retryable response", async () => {
    const response = await createStagingMeasurementApiHandler(
      new Request("https://app.test/api/staging/pilot-measurements", { method: "POST", headers: { authorization: "Bearer fixture", "content-type": "application/json" }, body: JSON.stringify(capture) }),
      dependencies({ repository: { saveMeasurement: async () => { throw new Error("db details must not escape") }, readMeasurement: async () => record } }),
    )
    assert.equal(response.status, 502)
    assert.deepEqual(await response.json(), { error: { code: "measurement_persistence_unavailable", retryable: true } })
  })
})
