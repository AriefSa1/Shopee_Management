import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { createInternalSessionService, parseInternalSessionConfig } from "./internal-session.ts"

const environment = {
  INTERNAL_ORGANIZATION_ID: "10000000-0000-4000-8000-000000000001",
  INTERNAL_AUTH_SUBJECT: "owner@internal.example",
  INTERNAL_LOGIN_TOKEN: Buffer.alloc(32, 1).toString("base64url"),
  WEB_SESSION_SECRET: Buffer.alloc(32, 2).toString("base64url"),
  WEB_SESSION_LIFETIME_SECONDS: "28800",
  PUBLIC_BASE_URL: "https://app.example.test",
} as const

describe("internal operator session", () => {
  it("issues an HttpOnly secure session and authenticates the following request", async () => {
    // Given: a valid high-entropy login token and production HTTPS configuration.
    const service = createInternalSessionService(parseInternalSessionConfig(environment))

    // When: the internal owner logs in and reuses the returned cookie.
    const login = await service.login(
      new Request("https://app.example.test/api/session/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ loginToken: environment.INTERNAL_LOGIN_TOKEN }),
      }),
    )
    const cookie = login.headers.get("set-cookie")
    assert.notEqual(cookie, null)
    const authenticated = service.authenticate(
      new Request("https://app.example.test/api/auth/shopee/start", {
        headers: { cookie: cookie?.split(";")[0] ?? "" },
      }),
    )

    // Then: only the configured organization and operator identity are trusted.
    assert.equal(login.status, 204)
    assert.match(cookie ?? "", /HttpOnly/)
    assert.match(cookie ?? "", /Secure/)
    assert.deepEqual(authenticated, {
      organizationId: environment.INTERNAL_ORGANIZATION_ID,
      actor: {
        issuer: "https://app.example.test/internal-auth",
        subject: environment.INTERNAL_AUTH_SUBJECT,
      },
    })
  })

  it("rejects an invalid login token without issuing a cookie", async () => {
    // Given: a configured internal session service.
    const service = createInternalSessionService(parseInternalSessionConfig(environment))

    // When: a caller presents the wrong bootstrap token.
    const response = await service.login(
      new Request("https://app.example.test/api/session/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ loginToken: Buffer.alloc(32, 3).toString("base64url") }),
      }),
    )

    // Then: authentication is denied and no session cookie is created.
    assert.equal(response.status, 401)
    assert.equal(response.headers.get("set-cookie"), null)
  })
})
