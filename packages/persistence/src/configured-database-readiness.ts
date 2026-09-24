import { Client } from "pg"
import type { DatabaseReadinessProbe } from "../../domain/src/readiness.ts"

export type DatabaseConnectivityProbe = (databaseUrl: string) => Promise<void>

export type ConfiguredDatabaseReadinessOptions = {
  readonly probe?: DatabaseConnectivityProbe
  readonly timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 1_000

export function createConfiguredDatabaseReadinessProbe(
  databaseUrl: string | undefined,
  options: ConfiguredDatabaseReadinessOptions = {},
): DatabaseReadinessProbe {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const probe = options.probe ?? ((url: string) => probePostgres(url, timeoutMs))

  return {
    check: async () => {
      if (databaseUrl === undefined) return { state: "missing", reason: "configuration_missing" }

      try {
        await probe(databaseUrl)
        return { state: "ready", reason: "probe_succeeded" }
      } catch (error) {
        if (error instanceof Error) return { state: "unavailable", reason: "connectivity_failed" }
        throw error
      }
    },
  }
}

async function probePostgres(databaseUrl: string, timeoutMs: number): Promise<void> {
  const client = new Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: timeoutMs,
    query_timeout: timeoutMs,
  })

  await client.connect()
  try {
    await client.query("SELECT 1")
  } finally {
    await client.end()
  }
}
