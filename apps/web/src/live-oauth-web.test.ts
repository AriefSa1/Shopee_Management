import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type {
  PostgresExecutor,
  SqlStatement,
} from "../../../packages/delivery/src/postgres-delivery.ts"
import { createInternalSessionService, parseInternalSessionConfig } from "./internal-session.ts"
import { createLiveOAuthWebDependencies, parseLiveOAuthWebConfig } from "./live-oauth-web.ts"

const environment = {
  DATABASE_URL: "postgresql://db.example/app",
  INTERNAL_ORGANIZATION_ID: "10000000-0000-4000-8000-000000000001",
  INTERNAL_AUTH_SUBJECT: "owner@internal.example",
  INTERNAL_LOGIN_TOKEN: Buffer.alloc(32, 1).toString("base64url"),
  WEB_SESSION_SECRET: Buffer.alloc(32, 2).toString("base64url"),
  PUBLIC_BASE_URL: "https://app.example.test",
  SHOPEE_PARTNER_ID: "2043951",
  SHOPEE_PARTNER_APPLICATION_ID: "20000000-0000-4000-8000-000000000001",
  WORKER_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64url"),
  CREDENTIAL_ENCRYPTION_KEY_VERSION: "1",
} as const

class OwnerExecutor implements PostgresExecutor {
  readonly statements: SqlStatement[] = []

  async query(statement: SqlStatement) {
    this.statements.push(statement)
    if (statement.name === "oauth.web.owner.authorize") return [{ role: "owner" }]
    return []
  }

  async transaction<T>(work: (executor: PostgresExecutor) => Promise<T>): Promise<T> {
    return work(this)
  }
}

describe("live OAuth web composition", () => {
  it("builds a production Shopee authorization URL for an authenticated owner", async () => {
    // Given: complete live configuration, an owner membership, and a signed session.
    const executor = new OwnerExecutor()
    const session = createInternalSessionService(parseInternalSessionConfig(environment))
    const login = await session.login(
      new Request("https://app.example.test/api/session/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ loginToken: environment.INTERNAL_LOGIN_TOKEN }),
      }),
    )
    const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? ""
    const config = parseLiveOAuthWebConfig(environment)
    const dependencies = createLiveOAuthWebDependencies({
      config,
      executor,
      session,
    })

    // When: the owner starts the configured Indonesian partner application flow.
    const request = new Request(
      `${environment.PUBLIC_BASE_URL}/api/auth/shopee/start?organizationId=${environment.INTERNAL_ORGANIZATION_ID}&partnerApplicationId=${environment.SHOPEE_PARTNER_APPLICATION_ID}&market=ID`,
      { headers: { cookie } },
    )
    const authenticated = dependencies.authenticate(request)
    assert.notEqual(authenticated, null)
    if (authenticated === null) throw new TypeError("Expected authenticated test session")
    const authorized = await dependencies.authorize?.(request, authenticated)
    const issued = dependencies.issueState({
      attemptId: dependencies.nextAttemptId(),
      organizationId: authenticated.organizationId,
      actor: authenticated.actor,
      partnerApplicationId: config.partnerApplicationId,
      market: "ID",
      stateHash: dependencies.hashState("attempt"),
      issuedAt: "2026-09-22T00:00:00.000Z",
      expiresAt: "2026-09-22T00:10:00.000Z",
    })
    const authorizationUrl = new URL(dependencies.authorizationUrl(issued))

    // Then: owner authorization succeeds and the redirect is bound to the live callback.
    assert.equal(authorized, true)
    assert.equal(
      authorizationUrl.origin + authorizationUrl.pathname,
      "https://open.shopee.com/auth",
    )
    assert.equal(authorizationUrl.searchParams.get("partner_id"), environment.SHOPEE_PARTNER_ID)
    assert.equal(
      authorizationUrl.searchParams.get("redirect_uri"),
      `${environment.PUBLIC_BASE_URL}/api/auth/shopee/callback`,
    )
  })
})
