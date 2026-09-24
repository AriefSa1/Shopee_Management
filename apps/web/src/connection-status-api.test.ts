import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type {
  PostgresExecutor,
  SqlRow,
  SqlStatement,
} from "../../../packages/delivery/src/postgres-delivery.ts"
import { OrganizationIdSchema } from "../../../packages/identity/src/model.ts"
import type { OAuthWebAuthContext } from "../../../packages/oauth/src/oauth-api.ts"
import { createConnectionStatusApiHandler } from "./connection-status-api.ts"

const organizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
const context: OAuthWebAuthContext = {
  organizationId,
  actor: { issuer: "https://app.example.test/internal-auth", subject: "operator" },
}

class FakeConnectionExecutor implements PostgresExecutor {
  readonly statements: SqlStatement[] = []
  private readonly rows: readonly SqlRow[]
  constructor(rows: readonly SqlRow[]) {
    this.rows = rows
  }
  async query(statement: SqlStatement): Promise<readonly SqlRow[]> {
    this.statements.push(statement)
    return this.rows
  }
  async transaction<T>(work: (executor: PostgresExecutor) => Promise<T>): Promise<T> {
    return work(this)
  }
}

const request = new Request("https://app.example.test/api/connections", {
  headers: { accept: "application/json" },
})

describe("connection status API", () => {
  it("classifies stored, expired, awaiting, and reauth credentials and summarizes them", async () => {
    const executor = new FakeConnectionExecutor([
      {
        id: "30000000-0000-4000-8000-000000000001",
        external_shop_id: "111",
        market: "ID",
        connection_status: "active",
        created_at: "2026-09-01T00:00:00.000Z",
        credential_ready: true,
        credential_expired: false,
        binding_reauth: false,
        credential_expires_at: "2026-10-09T00:00:00.000Z",
      },
      {
        id: "30000000-0000-4000-8000-000000000002",
        external_shop_id: "222",
        market: "ID",
        connection_status: "active",
        created_at: "2026-09-02T00:00:00.000Z",
        credential_ready: false,
        credential_expired: true,
        binding_reauth: false,
        credential_expires_at: "2026-09-01T00:00:00.000Z",
      },
      {
        id: "30000000-0000-4000-8000-000000000003",
        external_shop_id: "333",
        market: "ID",
        connection_status: "active",
        created_at: "2026-09-03T00:00:00.000Z",
        credential_ready: false,
        credential_expired: false,
        binding_reauth: false,
        credential_expires_at: null,
      },
      {
        id: "30000000-0000-4000-8000-000000000004",
        external_shop_id: "444",
        market: "ID",
        connection_status: "active",
        created_at: "2026-09-04T00:00:00.000Z",
        credential_ready: false,
        credential_expired: false,
        binding_reauth: true,
        credential_expires_at: null,
      },
    ])
    const response = await createConnectionStatusApiHandler(request, {
      authenticate: () => context,
      executor,
    })
    assert.equal(response.status, 200)
    const body = (await response.json()) as {
      data: {
        connections: readonly {
          state: string
          credentialStored: boolean
          credentialExpiresAt: string | null
        }[]
        summary: {
          total: number
          ready: number
          awaitingExchange: number
          expired: number
          reauthRequired: number
        }
      }
    }
    assert.deepEqual(body.data.summary, {
      total: 4,
      ready: 1,
      awaitingExchange: 1,
      expired: 1,
      reauthRequired: 1,
    })
    assert.equal(body.data.connections[0]?.state, "ready")
    assert.equal(body.data.connections[0]?.credentialStored, true)
    assert.equal(body.data.connections[0]?.credentialExpiresAt, "2026-10-09T00:00:00.000Z")
    assert.equal(body.data.connections[1]?.state, "expired")
    assert.equal(body.data.connections[1]?.credentialStored, false)
    assert.equal(body.data.connections[2]?.state, "awaiting_exchange")
    assert.equal(body.data.connections[3]?.state, "reauth_required")
    assert.equal(executor.statements[0]?.name, "web.connections.status")
  })

  it("fails closed without an authenticated operator session", async () => {
    const executor = new FakeConnectionExecutor([])
    const response = await createConnectionStatusApiHandler(request, {
      authenticate: () => null,
      executor,
    })
    assert.equal(response.status, 401)
    assert.equal(executor.statements.length, 0)
  })
})
