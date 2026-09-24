import { Pool } from "pg"
import {
  createPostgresExecutor,
  type PostgresPool,
  type PostgresPoolClient,
} from "./postgres-executor.ts"

try {
  process.loadEnvFile(new URL("../../../.env", import.meta.url))
} catch {}

const databaseUrl = process.env["DATABASE_URL"]
if (databaseUrl === undefined || databaseUrl.length === 0) {
  console.log(
    JSON.stringify({
      scenario: "phase2-live-postgres-executor",
      status: "blocked",
      reason: "database_configuration_missing",
      secretValuesEmitted: false,
    }),
  )
  process.exitCode = 1
} else {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 2_000,
    query_timeout: 2_000,
  })
  const executor = createPostgresExecutor(asPostgresPool(pool))
  try {
    const identity = await executor.query({
      name: "manual.identity",
      text: "SELECT current_database() AS database_name, current_user AS database_user",
      params: [],
    })
    const tables = await executor.query({
      name: "manual.oauth_tables",
      text: `SELECT
        to_regclass('public.oauth_states') AS oauth_states,
        to_regclass('public.credential_subjects') AS credential_subjects,
        to_regclass('public.shop_credential_bindings') AS shop_credential_bindings,
        to_regclass('public.oauth_grants') AS oauth_grants,
        to_regclass('public.oauth_grant_subjects') AS oauth_grant_subjects,
        to_regclass('public.oauth_grant_subject_shops') AS oauth_grant_subject_shops`,
      params: [],
    })
    await executor.transaction(async (tx) => {
      await tx.query({
        name: "manual.transaction",
        text: "SELECT 1 AS transaction_probe",
        params: [],
      })
    })
    const identityRow = identity[0] ?? {}
    const tableRow = tables[0] ?? {}
    const tableNames = [
      "oauth_states",
      "credential_subjects",
      "shop_credential_bindings",
      "oauth_grants",
      "oauth_grant_subjects",
      "oauth_grant_subject_shops",
    ]
    const missingTables = tableNames.filter((name) => tableRow[name] !== name)
    console.log(
      JSON.stringify({
        scenario: "phase2-live-postgres-executor",
        status: missingTables.length === 0 ? "pass" : "partial",
        databaseConfigured: true,
        databaseName: identityRow["database_name"],
        databaseUser: identityRow["database_user"],
        oauthTablesPresent: missingTables.length === 0,
        missingTables,
        transactionCommitted: true,
        secretValuesEmitted: false,
      }),
    )
  } finally {
    await pool.end()
  }
}

function asPostgresPool(pool: Pool): PostgresPool {
  return {
    async connect(): Promise<PostgresPoolClient> {
      const client = await pool.connect()
      return {
        async query(text, params = []) {
          const result = await client.query(text, [...params])
          return { rows: result.rows }
        },
        release() {
          client.release()
        },
      }
    },
  }
}
