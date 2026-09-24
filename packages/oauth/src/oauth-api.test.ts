import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { IdentitySchema, OrganizationIdSchema } from "../../identity/src/model.ts"
import { InMemoryOAuthDurableRepository } from "./durable-contracts.ts"
import { OAuthAttemptIdSchema, OAuthStateHashSchema, PartnerApplicationIdSchema } from "./model.ts"
import {
  createOAuthCallbackApiHandler,
  createOAuthStartApiHandler,
  type OAuthWebApiDependencies,
} from "./oauth-api.ts"
import { claimOAuthCallback, createOAuthStateRecord, InMemoryOAuthStateStore } from "./state.ts"

const organizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
const foreignOrganizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000002")
const actor = IdentitySchema.parse({ issuer: "https://id.example.test", subject: "oauth-owner" })
const foreignActor = IdentitySchema.parse({
  issuer: "https://id.example.test",
  subject: "foreign-user",
})
const partnerApplicationId = PartnerApplicationIdSchema.parse("partner-api-fixture")
const stateHash = OAuthStateHashSchema.parse("state-api-fixture-000000000000000000000000000001")

function dependencies(overrides: Partial<OAuthWebApiDependencies> = {}): OAuthWebApiDependencies {
  const stateStore = new InMemoryOAuthStateStore([])
  const durable = new InMemoryOAuthDurableRepository()
  return {
    authenticate: () => ({ organizationId, actor }),
    stateStore,
    durable,
    now: () => "2026-09-09T00:00:00.000Z",
    stateLifetimeSeconds: 600,
    nextAttemptId: () => OAuthAttemptIdSchema.parse("40000000-0000-4000-8000-000000000001"),
    hashState: () => stateHash,
    issueState: (input) => {
      const record = createOAuthStateRecord({
        attemptId: input.attemptId,
        organizationId: input.organizationId,
        actor: input.actor,
        partnerApplicationId: input.partnerApplicationId,
        market: input.market,
        stateHash,
        issuedAt: "2026-09-09T00:00:00.000Z",
        expiresAt: "2026-09-09T00:10:00.000Z",
      })
      return { state: "opaque-state-fixture", record: { ...record, attemptId: input.attemptId } }
    },
    authorizationUrl: ({ state }) => `https://provider.example.test/oauth?state=${state}`,
    ...overrides,
  }
}

describe("provider-free OAuth web boundary", () => {
  it("requires authentication before starting authorization", async () => {
    // Given: a browser request without an authenticated actor.
    const deps = dependencies({ authenticate: () => null })

    // When: the authorization-start boundary is requested.
    const response = await createOAuthStartApiHandler(
      new Request(
        `https://app.example.test/api/auth/shopee/start?organizationId=${organizationId}&partnerApplicationId=${partnerApplicationId}&market=ID`,
        { headers: { authorization: "Bearer fixture" } },
      ),
      deps,
    )

    // Then: no state is issued and the boundary denies the request.
    assert.equal(response.status, 401)
    assert.deepEqual(await response.json(), { error: { code: "authentication_required" } })
  })

  it("accepts a session-authenticated callback without requiring a bearer header", async () => {
    // Given: an identity adapter that authenticated the same operator session which started OAuth.
    const deps = dependencies()
    const start = await createOAuthStartApiHandler(
      new Request(
        `https://app.example.test/api/auth/shopee/start?organizationId=${organizationId}&partnerApplicationId=${partnerApplicationId}&market=ID`,
      ),
      deps,
    )
    assert.equal(start.status, 200)

    // When: Shopee redirects the browser callback without an application bearer header.
    const callback = await createOAuthCallbackApiHandler(
      new Request(
        "https://app.example.test/api/auth/shopee/callback?state=opaque-state-fixture&shop_id=1819834906&code=raw-code-fixture",
      ),
      deps,
    )

    // Then: the authenticated session is accepted and only the safe pending response is returned.
    assert.equal(callback.status, 202)
    assert.deepEqual(await callback.json(), {
      data: {
        attemptId: "40000000-0000-4000-8000-000000000001",
        organizationId,
        status: "claimed",
        next: "worker_exchange_pending",
      },
    })
  })

  it("issues a safe authorization projection bound to the authenticated organization", async () => {
    // Given: an authenticated owner and an injected state issuer.
    const deps = dependencies()

    // When: the owner starts authorization for its organization.
    const response = await createOAuthStartApiHandler(
      new Request(
        `https://app.example.test/api/auth/shopee/start?organizationId=${organizationId}&partnerApplicationId=${partnerApplicationId}&market=ID`,
        { headers: { authorization: "Bearer fixture" } },
      ),
      deps,
    )
    const body = (await response.json()) as Record<string, unknown>

    // Then: the response contains only the redirect contract and no credentials or exchange callable.
    assert.equal(response.status, 200)
    assert.deepEqual(body, {
      data: {
        organizationId,
        partnerApplicationId,
        market: "ID",
        state: "opaque-state-fixture",
        authorizationUrl: "https://provider.example.test/oauth?state=opaque-state-fixture",
        status: "issued",
      },
    })
    assert.equal("partnerKey" in body, false)
    assert.equal("callbackCode" in body, false)
    assert.equal("exchange" in body, false)
  })

  it("persists the issued state before returning the authorization URL", async () => {
    // Given: a production-style durable state writer.
    const persisted: string[] = []
    const deps = dependencies({
      persistState: async (record) => {
        persisted.push(record.stateHash)
      },
    })

    // When: an authenticated owner starts authorization.
    const response = await createOAuthStartApiHandler(
      new Request(
        `https://app.example.test/api/auth/shopee/start?organizationId=${organizationId}&partnerApplicationId=${partnerApplicationId}&market=ID`,
      ),
      deps,
    )

    // Then: durable persistence completes before a successful response is returned.
    assert.equal(response.status, 200)
    assert.deepEqual(persisted, [stateHash])
  })

  it("hashes the opaque provider state rather than the internal attempt id", async () => {
    const hashedInputs: string[] = []
    const deps = dependencies({
      hashState: (value: string) => {
        hashedInputs.push(value)
        return stateHash
      },
    })

    const response = await createOAuthStartApiHandler(
      new Request(
        `https://app.example.test/api/auth/shopee/start?organizationId=${organizationId}&partnerApplicationId=${partnerApplicationId}&market=ID`,
        { headers: { authorization: "Bearer fixture" } },
      ),
      deps,
    )

    assert.equal(response.status, 200)
    assert.equal(hashedInputs.at(-1), "opaque-state-fixture")
    assert.notEqual(hashedInputs.at(-1), "40000000-0000-4000-8000-000000000001")
    assert.equal(deps.stateStore.get(stateHash)?.stateHash, stateHash)
  })

  it("uses the injected atomic claim seam so concurrent callbacks produce one claim", async () => {
    const deps = dependencies()
    await createOAuthStartApiHandler(
      new Request(
        `https://app.example.test/api/auth/shopee/start?organizationId=${organizationId}&partnerApplicationId=${partnerApplicationId}&market=ID`,
        { headers: { authorization: "Bearer fixture" } },
      ),
      deps,
    )
    let claimCalls = 0
    const atomicDeps = dependencies({
      stateStore: deps.stateStore,
      durable: deps.durable,
      claimState: async (input) => {
        claimCalls += 1
        await Promise.resolve()
        return claimOAuthCallback(input, deps.stateStore)
      },
    })
    const request = () =>
      createOAuthCallbackApiHandler(
        new Request(
          "https://app.example.test/api/auth/shopee/callback?state=opaque-state-fixture&shop_id=1819834906&code=raw-code-fixture",
          { headers: { authorization: "Bearer fixture" } },
        ),
        atomicDeps,
      )

    const responses = await Promise.all([request(), request()])
    assert.equal(claimCalls, 2)
    assert.deepEqual(responses.map((response) => response.status).sort(), [202, 409])
  })

  it("denies OAuth authorization when the injected owner permission check fails", async () => {
    const deps = dependencies({ authorize: () => false })
    const response = await createOAuthStartApiHandler(
      new Request(
        `https://app.example.test/api/auth/shopee/start?organizationId=${organizationId}&partnerApplicationId=${partnerApplicationId}&market=ID`,
        { headers: { authorization: "Bearer fixture" } },
      ),
      deps,
    )

    assert.equal(response.status, 403)
    assert.deepEqual(await response.json(), { error: { code: "oauth_permission_required" } })
    assert.equal(deps.stateStore.get(stateHash), undefined)
  })

  it("claims callback once, persists only a safe attempt, and never exchanges in web", async () => {
    // Given: a previously issued state and a durable repository.
    const deps = dependencies()
    const start = await createOAuthStartApiHandler(
      new Request(
        `https://app.example.test/api/auth/shopee/start?organizationId=${organizationId}&partnerApplicationId=${partnerApplicationId}&market=ID`,
        { headers: { authorization: "Bearer fixture" } },
      ),
      deps,
    )
    assert.equal(start.status, 200)

    // When: the provider callback is delivered with an authenticated actor.
    const callback = await createOAuthCallbackApiHandler(
      new Request(
        "https://app.example.test/api/auth/shopee/callback?state=opaque-state-fixture&shop_id=1819834906&code=raw-code-fixture",
        { headers: { authorization: "Bearer fixture" } },
      ),
      deps,
    )
    const callbackBody = (await callback.json()) as Record<string, unknown>

    // Then: only a worker-pending safe projection is returned and the callback code is not persisted.
    assert.equal(callback.status, 202)
    assert.deepEqual(callbackBody, {
      data: {
        attemptId: "40000000-0000-4000-8000-000000000001",
        organizationId,
        status: "claimed",
        next: "worker_exchange_pending",
      },
    })
    const stored = await deps.durable.getAttempt(
      organizationId,
      OAuthAttemptIdSchema.parse("40000000-0000-4000-8000-000000000001"),
    )
    assert.equal("callbackCode" in (stored ?? {}), false)
    assert.equal("raw-code-fixture" in (stored ?? {}), false)

    // When: the same callback is replayed.
    const replay = await createOAuthCallbackApiHandler(
      new Request(
        "https://app.example.test/api/auth/shopee/callback?state=opaque-state-fixture&shop_id=1819834906&code=raw-code-fixture",
        { headers: { authorization: "Bearer fixture" } },
      ),
      deps,
    )

    // Then: replay is denied without an exchange attempt.
    assert.equal(replay.status, 409)
    assert.deepEqual(await replay.json(), { error: { code: "state_already_claimed" } })
  })

  it("denies organization and actor substitution before claiming state", async () => {
    // Given: a state owned by the authenticated organization and actor.
    const deps = dependencies()
    await createOAuthStartApiHandler(
      new Request(
        `https://app.example.test/api/auth/shopee/start?organizationId=${organizationId}&partnerApplicationId=${partnerApplicationId}&market=ID`,
        { headers: { authorization: "Bearer fixture" } },
      ),
      deps,
    )

    // When: a foreign organization is supplied to start.
    const foreignStart = await createOAuthStartApiHandler(
      new Request(
        `https://app.example.test/api/auth/shopee/start?organizationId=${foreignOrganizationId}&partnerApplicationId=${partnerApplicationId}&market=ID`,
        { headers: { authorization: "Bearer fixture" } },
      ),
      deps,
    )

    // Then: organization substitution is rejected.
    assert.equal(foreignStart.status, 403)
    assert.deepEqual(await foreignStart.json(), { error: { code: "organization_mismatch" } })

    // When: a different authenticated actor receives the callback.
    const foreignCallback = await createOAuthCallbackApiHandler(
      new Request(
        "https://app.example.test/api/auth/shopee/callback?state=opaque-state-fixture&shop_id=1819834906&code=raw-code-fixture",
        { headers: { authorization: "Bearer fixture" } },
      ),
      dependencies({
        authenticate: () => ({ organizationId, actor: foreignActor }),
        stateStore: deps.stateStore,
        durable: deps.durable,
        now: () => "2026-09-09T00:05:00.000Z",
        stateLifetimeSeconds: 600,
      }),
    )

    // Then: the callback is denied without claiming state.
    assert.equal(foreignCallback.status, 403)
    assert.deepEqual(await foreignCallback.json(), { error: { code: "state_actor_mismatch" } })

    const foreignOrganizationCallback = await createOAuthCallbackApiHandler(
      new Request(
        "https://app.example.test/api/auth/shopee/callback?state=opaque-state-fixture&shop_id=1819834906&code=raw-code-fixture",
        { headers: { authorization: "Bearer fixture" } },
      ),
      dependencies({
        authenticate: () => ({ organizationId: foreignOrganizationId, actor }),
        stateStore: deps.stateStore,
        durable: deps.durable,
        now: () => "2026-09-09T00:05:00.000Z",
        stateLifetimeSeconds: 600,
      }),
    )
    assert.equal(foreignOrganizationCallback.status, 403)
    assert.deepEqual(await foreignOrganizationCallback.json(), {
      error: { code: "state_organization_mismatch" },
    })
  })

  it("denies an expired callback and does not invoke a provider", async () => {
    // Given: an expired state store and no provider dependency.
    const stateStore = new InMemoryOAuthStateStore([
      createOAuthStateRecord({
        attemptId: OAuthAttemptIdSchema.parse("40000000-0000-4000-8000-000000000002"),
        organizationId,
        actor,
        partnerApplicationId,
        market: "ID",
        stateHash,
        issuedAt: "2026-09-09T00:00:00.000Z",
        expiresAt: "2026-09-09T00:04:00.000Z",
      }),
    ])
    const deps = dependencies({ stateStore, now: () => "2026-09-09T00:05:00.000Z" })

    // When: the callback arrives after state expiry.
    const response = await createOAuthCallbackApiHandler(
      new Request(
        "https://app.example.test/api/auth/shopee/callback?state=opaque-state-fixture&shop_id=1819834906&code=raw-code-fixture",
        { headers: { authorization: "Bearer fixture" } },
      ),
      deps,
    )

    // Then: expiry is explicit and no worker exchange surface is exposed.
    assert.equal(response.status, 410)
    assert.deepEqual(await response.json(), { error: { code: "state_expired" } })
  })

  it("uses the durable callback handoff before any legacy claim or attempt write", async () => {
    // Given: a transactional callback handoff boundary.
    let handoffCalls = 0
    const deps = dependencies({
      callbackHandoff: async (input) => {
        handoffCalls += 1
        assert.equal(input.code, "raw-code-fixture")
        return {
          kind: "accepted",
          attemptId: "40000000-0000-4000-8000-000000000001",
          commandId: "50000000-0000-4000-8000-000000000001",
          eventId: "60000000-0000-4000-8000-000000000001",
        }
      },
      claimState: async () => {
        throw new Error("legacy claim must not run")
      },
    })

    // When: the provider callback reaches the web boundary.
    const response = await createOAuthCallbackApiHandler(
      new Request(
        "https://app.example.test/api/auth/shopee/callback?state=opaque-state-fixture&shop_id=1819834906&code=raw-code-fixture",
        { headers: { authorization: "Bearer fixture" } },
      ),
      deps,
    )

    // Then: the safe pending response comes from the durable handoff.
    assert.equal(response.status, 202)
    assert.equal(handoffCalls, 1)
    assert.deepEqual(await response.json(), {
      data: {
        attemptId: "40000000-0000-4000-8000-000000000001",
        organizationId,
        status: "claimed",
        next: "worker_exchange_pending",
      },
    })
  })
})
