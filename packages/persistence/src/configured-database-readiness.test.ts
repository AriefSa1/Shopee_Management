import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { createConfiguredDatabaseReadinessProbe } from "./configured-database-readiness.ts"

describe("configured database readiness", () => {
  it("reports ready after the configured database probe succeeds", async () => {
    const observedUrls: string[] = []
    const probe = createConfiguredDatabaseReadinessProbe("postgresql://db.example/app", {
      probe: async (databaseUrl) => {
        observedUrls.push(databaseUrl)
      },
    })

    const readiness = await probe.check()

    assert.deepEqual(readiness, { state: "ready", reason: "probe_succeeded" })
    assert.deepEqual(observedUrls, ["postgresql://db.example/app"])
  })

  it("fails closed when the configured database probe fails", async () => {
    const probe = createConfiguredDatabaseReadinessProbe("postgresql://db.example/app", {
      probe: async () => {
        throw new Error("database unavailable")
      },
    })

    const readiness = await probe.check()

    assert.deepEqual(readiness, { state: "unavailable", reason: "connectivity_failed" })
  })
})
