import assert from "node:assert/strict"
import test from "node:test"
import {
  createPostgresExecutor,
  PostgresExecutorError,
  type PostgresPool,
  type PostgresPoolClient,
} from "./postgres-executor.ts"

type QueryResult = { readonly rows: readonly Record<string, unknown>[] }

class FakeClient implements PostgresPoolClient {
  readonly calls: string[] = []
  released = false
  shouldFailCommit = false

  async query(text: string, params: readonly unknown[] = []): Promise<QueryResult> {
    this.calls.push(`${text}|${JSON.stringify(params)}`)
    if (text === "SELECT value")
      return { rows: [{ value: 0, at: new Date("2026-01-01T00:00:00.000Z") }] }
    if (text === "COMMIT" && this.shouldFailCommit) throw new Error("commit failed")
    return { rows: [] }
  }

  release(): void {
    this.released = true
  }
}

class FakePool implements PostgresPool {
  readonly client = new FakeClient()
  async connect(): Promise<PostgresPoolClient> {
    return this.client
  }
}

test("executes parameterized queries and maps supported postgres scalar values", async () => {
  const pool = new FakePool()
  const executor = createPostgresExecutor(pool)
  const rows = await executor.query({ name: "probe", text: "SELECT value", params: [] })

  assert.deepEqual(rows, [{ value: 0, at: "2026-01-01T00:00:00.000Z" }])
  assert.equal(pool.client.calls.length, 1)
})

test("commits successful transactions and releases the client", async () => {
  const pool = new FakePool()
  const executor = createPostgresExecutor(pool)
  const result = await executor.transaction(async (tx) => {
    await tx.query({ name: "write", text: "INSERT", params: ["org-1", 0, true, null] })
    return "done"
  })

  assert.equal(result, "done")
  assert.equal(pool.client.calls[0], "BEGIN|[]")
  assert.equal(pool.client.calls[2], "COMMIT|[]")
  assert.equal(pool.client.released, true)
})

test("rolls back and releases the client when work fails", async () => {
  const pool = new FakePool()
  const executor = createPostgresExecutor(pool)

  await assert.rejects(
    executor.transaction(async () => {
      throw new Error("work failed")
    }),
    /work failed/,
  )
  assert.equal(pool.client.calls[0], "BEGIN|[]")
  assert.equal(pool.client.calls[1], "ROLLBACK|[]")
  assert.equal(pool.client.released, true)
})

test("wraps unsupported row values as an executor error", async () => {
  const pool: PostgresPool = {
    async connect() {
      return {
        async query() {
          return { rows: [{ unsupported: { nested: true } }] }
        },
        release() {},
      }
    },
  }
  const executor = createPostgresExecutor(pool)

  await assert.rejects(
    executor.query({ name: "unsupported", text: "SELECT unsupported", params: [] }),
    (error: unknown) =>
      error instanceof PostgresExecutorError && error.code === "unsupported_row_value",
  )
})
