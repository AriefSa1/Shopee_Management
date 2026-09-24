import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { OrganizationIdSchema } from "../../../packages/identity/src/model.ts"
import { InMemoryOAuthDurableRepository } from "../../../packages/oauth/src/durable-contracts.ts"
import {
  OAuthAttemptIdSchema,
  OAuthStateHashSchema,
  PartnerApplicationIdSchema,
} from "../../../packages/oauth/src/model.ts"
import {
  createOAuthStateRecord,
  InMemoryOAuthStateStore,
} from "../../../packages/oauth/src/state.ts"
import { createConfiguredDatabaseReadinessProbe } from "../../../packages/persistence/src/configured-database-readiness.ts"
import {
  createInternalSessionService,
  type InternalSessionService,
  parseInternalSessionConfig,
} from "./internal-session.ts"
import { createProductionWebApp } from "./production-app.ts"

const environment = {
  INTERNAL_ORGANIZATION_ID: "10000000-0000-4000-8000-000000000001",
  INTERNAL_AUTH_SUBJECT: "owner@internal.example",
  INTERNAL_LOGIN_TOKEN: Buffer.alloc(32, 1).toString("base64url"),
  WEB_SESSION_SECRET: Buffer.alloc(32, 2).toString("base64url"),
  PUBLIC_BASE_URL: "https://app.example.test",
} as const

function buildProductionWebApp(session: InternalSessionService) {
  const stateHash = OAuthStateHashSchema.parse("state-production-fixture-000000000000000000000001")
  return createProductionWebApp({
    database: createConfiguredDatabaseReadinessProbe(undefined),
    session,
    connection: {
      organizationId: OrganizationIdSchema.parse(environment.INTERNAL_ORGANIZATION_ID),
      partnerApplicationId: PartnerApplicationIdSchema.parse("20000000-0000-4000-8000-000000000001"),
      market: "ID",
    },
    oauth: {
      authenticate: session.authenticate,
      stateStore: new InMemoryOAuthStateStore([]),
      durable: new InMemoryOAuthDurableRepository(),
      now: () => "2026-09-22T00:00:00.000Z",
      stateLifetimeSeconds: 600,
      nextAttemptId: () => OAuthAttemptIdSchema.parse("40000000-0000-4000-8000-000000000001"),
      hashState: () => stateHash,
      issueState: (input) => ({ state: "opaque-state", record: createOAuthStateRecord(input) }),
      authorizationUrl: () => "https://open.shopee.com/auth",
    },
  })
}

describe("production web OAuth surface", () => {
  it("mounts session and OAuth routes while denying an unauthenticated authorization start", async () => {
    // Given: a production web app with fail-closed operator authentication.
    const session = createInternalSessionService(parseInternalSessionConfig(environment))
    const app = buildProductionWebApp(session)

    // When: an unauthenticated caller reaches the live authorization route.
    const oauth = await app.request(
      `/api/auth/shopee/start?organizationId=${environment.INTERNAL_ORGANIZATION_ID}&partnerApplicationId=20000000-0000-4000-8000-000000000001&market=ID`,
    )
    const login = await app.request("/api/session/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ loginToken: environment.INTERNAL_LOGIN_TOKEN }),
    })
    const dashboard = await app.request("/")
    const dashboardHtml = await dashboard.text()
    const connection = await app.request("/connect/shopee")
    const connectionHtml = await connection.text()

    // Then: OAuth is mounted and fail-closed, while the browser can enter through a safe UI.
    assert.equal(oauth.status, 401)
    assert.equal(login.status, 204)
    assert.notEqual(login.headers.get("set-cookie"), null)
    assert.match(dashboardHtml, /href="\/connect\/shopee"/)
    assert.equal(connection.status, 200)
    assert.equal(connection.headers.get("cache-control"), "no-store")
    assert.match(connection.headers.get("content-security-policy") ?? "", /connect-src 'self'/)
    assert.match(connectionHtml, /type="password"/)
    assert.match(connectionHtml, /Hubungkan ke Shopee/)
    assert.match(connectionHtml, /\/api\/session\/login/)
    assert.match(connectionHtml, /\/api\/session\/status/)
    assert.match(connectionHtml, /\/api\/auth\/shopee\/start/)
    assert.doesNotMatch(connectionHtml, new RegExp(environment.INTERNAL_LOGIN_TOKEN))
  })

  it("reports session status so the UI can skip the token step for an active operator", async () => {
    // Given: a production web app with the internal session service.
    const session = createInternalSessionService(parseInternalSessionConfig(environment))
    const app = buildProductionWebApp(session)

    // When: status is checked before and after a successful login.
    const anonymous = await app.request("/api/session/status")
    const anonymousBody = (await anonymous.json()) as { authenticated: boolean }
    const login = await app.request("/api/session/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ loginToken: environment.INTERNAL_LOGIN_TOKEN }),
    })
    const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? ""
    const authenticated = await app.request("/api/session/status", { headers: { cookie } })
    const authenticatedBody = (await authenticated.json()) as { authenticated: boolean }

    // Then: the endpoint reports the operator's session state without leaking the token.
    assert.equal(anonymous.status, 200)
    assert.equal(anonymous.headers.get("cache-control"), "no-store")
    assert.equal(anonymousBody.authenticated, false)
    assert.equal(authenticated.status, 200)
    assert.equal(authenticatedBody.authenticated, true)
  })
})
