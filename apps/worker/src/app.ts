import { Hono } from "hono"
import type { HealthResponse, ReadinessResponse } from "../../../packages/domain/src/health.ts"
import type { DatabaseReadinessProbe } from "../../../packages/domain/src/readiness.ts"

export function createWorkerApp(database: DatabaseReadinessProbe): Hono {
  const app = new Hono()

  app.get("/health", (context) =>
    context.json({ service: "worker", status: "ok" } satisfies HealthResponse),
  )
  app.get("/ready", async (context) => {
    const databaseReadiness = await database.check()
    const readiness = {
      service: "worker",
      status: databaseReadiness.state === "ready" ? "ready" : "not_ready",
      dependencies: { database: databaseReadiness },
    } satisfies ReadinessResponse
    return context.json(readiness, readiness.status === "ready" ? 200 : 503)
  })

  return app
}
