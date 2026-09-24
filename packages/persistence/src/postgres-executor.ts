import type {
  PostgresExecutor,
  SqlParameter,
  SqlRow,
  SqlStatement,
} from "../../delivery/src/postgres-delivery.ts"

export type PostgresQueryResult = {
  readonly rows: readonly Record<string, unknown>[]
}

export interface PostgresPoolClient {
  query(text: string, params?: readonly SqlParameter[]): Promise<PostgresQueryResult>
  release(): void
}

export interface PostgresPool {
  connect(): Promise<PostgresPoolClient>
}

export class PostgresExecutorError extends Error {
  readonly name = "PostgresExecutorError"
  readonly code = "unsupported_row_value" as const

  constructor(field: string) {
    super(`PostgreSQL returned an unsupported value for field: ${field}`)
  }
}

export function createPostgresExecutor(pool: PostgresPool): PostgresExecutor {
  return new PgExecutor(pool)
}

class PgExecutor implements PostgresExecutor {
  private readonly pool: PostgresPool
  private readonly client: PostgresPoolClient | undefined

  constructor(pool: PostgresPool, client?: PostgresPoolClient) {
    this.pool = pool
    this.client = client
  }

  async query(statement: SqlStatement): Promise<readonly SqlRow[]> {
    const client = this.client
    if (client !== undefined) return executeQuery(client, statement)
    const ownedClient = await this.pool.connect()
    try {
      return await executeQuery(ownedClient, statement)
    } finally {
      ownedClient.release()
    }
  }

  async transaction<T>(work: (executor: PostgresExecutor) => Promise<T>): Promise<T> {
    if (this.client !== undefined) return work(this)
    const client = await this.pool.connect()
    try {
      await client.query("BEGIN")
      const result = await work(new PgExecutor(this.pool, client))
      await client.query("COMMIT")
      return result
    } catch (error) {
      try {
        await client.query("ROLLBACK")
      } catch {}
      throw error
    } finally {
      client.release()
    }
  }
}

async function executeQuery(
  client: PostgresPoolClient,
  statement: SqlStatement,
): Promise<readonly SqlRow[]> {
  const result = await client.query(statement.text, statement.params)
  return result.rows.map((row) => mapRow(row))
}

function mapRow(row: Record<string, unknown>): SqlRow {
  const mapped: Record<string, SqlParameter | undefined> = {}
  for (const [field, value] of Object.entries(row)) mapped[field] = mapValue(field, value)
  return mapped
}

function mapValue(field: string, value: unknown): SqlParameter | undefined {
  if (
    value === undefined ||
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value
  }
  if (value instanceof Date) return value.toISOString()
  if (typeof value === "bigint") {
    const number = Number(value)
    if (Number.isSafeInteger(number)) return number
  }
  throw new PostgresExecutorError(field)
}
