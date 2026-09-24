import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { createConfiguredDatabaseReadinessProbe } from "../../../packages/persistence/src/configured-database-readiness.ts"
import { createWorkerApp } from "./app.ts"

describe("worker runtime health", () => {
  it("identifies the worker service when health is requested", async () => {
    // Given: an independently constructed worker runtime.
    const app = createWorkerApp(createConfiguredDatabaseReadinessProbe(undefined))

    // When: its health endpoint is requested.
    const response = await app.request("/health")

    // Then: the observable identifies worker, not web or a generic service.
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { service: "worker", status: "ok" })
  })

  it("reports unavailable persistence when the database probe fails", async () => {
    const app = createWorkerApp(
      createConfiguredDatabaseReadinessProbe("postgresql://local.invalid/app", {
        probe: async () => {
          throw new Error("database unavailable")
        },
      }),
    )

    // When: readiness is requested.
    const response = await app.request("/ready")

    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), {
      service: "worker",
      status: "not_ready",
      dependencies: {
        database: { state: "unavailable", reason: "connectivity_failed" },
      },
    })
  })
})
