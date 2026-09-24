import { serve } from "@hono/node-server"
import {
  ConfigValidationError,
  parseWorkerConfig,
} from "../../../packages/config/src/runtime-config.ts"
import { createConfiguredDatabaseReadinessProbe } from "../../../packages/persistence/src/configured-database-readiness.ts"
import { createWorkerApp } from "./app.ts"

function start(): void {
  const config = parseWorkerConfig(process.env)
  const app = createWorkerApp(createConfiguredDatabaseReadinessProbe(config.databaseUrl))

  serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
    process.stdout.write(
      `${JSON.stringify({ event: "listening", service: config.service, host: info.address, port: info.port })}\n`,
    )
  })
}

try {
  start()
} catch (error) {
  // no-excuse-ok: catch - process entrypoint converts safe typed configuration failures.
  if (error instanceof ConfigValidationError) {
    process.stderr.write(
      `${JSON.stringify({ event: "startup_rejected", error: error.name, fields: error.fieldNames })}\n`,
    )
    process.exitCode = 1
  } else {
    throw error
  }
}
