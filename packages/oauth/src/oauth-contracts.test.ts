import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  CallbackCodeSchema,
  AuthorizationGrantFixtureSchema,
  CredentialSubjectIdSchema,
  InMemoryOAuthStateStore,
  OAuthAttemptIdSchema,
  OAuthStateHashSchema,
  PartnerApplicationIdSchema,
  ShopeeShopIdSchema,
  authorizeShopCredentialBinding,
  claimOAuthCallback,
  createOAuthStateRecord,
  executeWorkerOnlyTokenExchange,
  normalizeAuthorizationGrant,
  parseOAuthCallbackInput,
  rotateCredentialSubject,
  toSafeOAuthAttempt,
  type AuthorizationGrantFixture,
} from "./index.ts"
import { IdentitySchema, OrganizationIdSchema, ShopIdSchema } from "../../identity/src/model.ts"
import { RUNTIME_POLICY_VERSION, RuntimeCapabilityDeniedError } from "../../runtime-boundaries/src/runtime-boundaries.ts"

const organizationA = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
const organizationB = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000002")
const shopA = ShopIdSchema.parse("30000000-0000-4000-8000-000000000001")
const shopB = ShopIdSchema.parse("30000000-0000-4000-8000-000000000002")
const actorA = IdentitySchema.parse({ issuer: "https://id.example.test", subject: "owner-a" })
const actorB = IdentitySchema.parse({ issuer: "https://id.example.test", subject: "owner-b" })
const issuedAt = "2026-09-09T00:00:00.000Z"
const expiresAt = "2026-09-09T00:10:00.000Z"
const now = "2026-09-09T00:05:00.000Z"
const stateHash = OAuthStateHashSchema.parse("state-hash-fixture-000000000000000000000000000001")
const shopeeShopId = ShopeeShopIdSchema.parse("1819834906")

function stateRecord() {
  return createOAuthStateRecord({
    attemptId: OAuthAttemptIdSchema.parse("40000000-0000-4000-8000-000000000001"),
    organizationId: organizationA,
    actor: actorA,
    partnerApplicationId: PartnerApplicationIdSchema.parse("partner-app-fixture"),
    market: "ID",
    stateHash,
    issuedAt,
    expiresAt,
  })
}

function grantFixture(): AuthorizationGrantFixture {
  return AuthorizationGrantFixtureSchema.parse({
    grantId: "50000000-0000-4000-8000-000000000001",
    organizationId: organizationA,
    partnerApplicationId: "partner-app-fixture",
    grantKind: "main_account",
    grantedAt: issuedAt,
    subjects: [
      {
        credentialSubjectId: "60000000-0000-4000-8000-000000000001",
        revision: 1,
        keyVersion: 1,
        shopIds: [shopA, shopB],
      },
    ],
  })
}

function grant() {
  return normalizeAuthorizationGrant(grantFixture())
}

describe("official OAuth callback contracts", () => {
  it("claims an unexpired state once for its bound actor", () => {
    // Given: an unclaimed state issued to actor A and stored as a hash only.
    const states = new InMemoryOAuthStateStore([stateRecord()])

    // When: actor A submits the matching callback state during its TTL.
    const result = claimOAuthCallback(
      { stateHash, organizationId: organizationA, actor: actorA, receivedAt: now, code: CallbackCodeSchema.parse("callback-code-canary"), shopId: shopeeShopId },
      states,
    )

    // Then: a worker-only claim is prepared without exposing raw state in the safe surface.
    assert.equal(result.kind, "claimed")
    const safeAttempt = toSafeOAuthAttempt(states.get(stateHash))
    assert.notEqual(safeAttempt, undefined)
    assert.equal(safeAttempt?.stateHash, undefined)
  })

  it("rejects malformed callback input before state lookup", () => {
    // Given: an untrusted callback without a valid state hash and code shape.
    const malformed: unknown = { stateHash: "wrong", actor: { issuer: "local", subject: "" }, code: "" }

    // When: the callback crosses the official OAuth boundary parser.
    const parse = (): void => {
      parseOAuthCallbackInput(malformed)
    }

    // Then: malformed input is rejected without ever selecting an OAuth state record.
    assert.throws(parse)
  })

  it("denies a replayed state after its first callback claim", () => {
    // Given: a state that has already produced one worker exchange claim.
    const states = new InMemoryOAuthStateStore([stateRecord()])
    claimOAuthCallback(
      { stateHash, organizationId: organizationA, actor: actorA, receivedAt: now, code: CallbackCodeSchema.parse("callback-code-canary"), shopId: shopeeShopId },
      states,
    )

    // When: the callback delivery is replayed.
    const replay = claimOAuthCallback(
      { stateHash, organizationId: organizationA, actor: actorA, receivedAt: now, code: CallbackCodeSchema.parse("callback-code-canary"), shopId: shopeeShopId },
      states,
    )

    // Then: the replay is denied before a code exchange can be scheduled.
    assert.deepEqual(replay, { kind: "denied", reason: "state_already_claimed" })
  })

  it("denies an expired state and a CSRF actor mismatch", () => {
    // Given: a valid state record bound to actor A.
    const expiredStates = new InMemoryOAuthStateStore([stateRecord()])
    const foreignActorStates = new InMemoryOAuthStateStore([stateRecord()])

    // When: one callback is delayed past TTL and another is submitted by actor B.
    const expired = claimOAuthCallback(
      {
        stateHash,
        organizationId: organizationA,
        actor: actorA,
        receivedAt: "2026-09-09T00:10:00.000Z",
        code: CallbackCodeSchema.parse("callback-code-canary"),
        shopId: shopeeShopId,
      },
      expiredStates,
    )
    const foreignActor = claimOAuthCallback(
      { stateHash, organizationId: organizationA, actor: actorB, receivedAt: now, code: CallbackCodeSchema.parse("callback-code-canary"), shopId: shopeeShopId },
      foreignActorStates,
    )

    // Then: both are safely denied by the state boundary.
    assert.deepEqual(expired, { kind: "denied", reason: "state_expired" })
    assert.deepEqual(foreignActor, { kind: "denied", reason: "state_actor_mismatch" })
  })
})

describe("grant, binding, and credential subject contracts", () => {
  it("keeps shared credential ownership on one subject while allowing both shops", () => {
    // Given: a main-account fixture authorizing two shops through one subject.
    const normalized = grant()

    // When: each organization-owned shop is checked against the grant binding.
    const shopAAccess = authorizeShopCredentialBinding({ organizationId: organizationA, shopId: shopA }, normalized)
    const shopBAccess = authorizeShopCredentialBinding({ organizationId: organizationA, shopId: shopB }, normalized)

    // Then: both resolve the same subject without a global token selector.
    assert.equal(shopAAccess.kind, "allowed")
    assert.equal(shopBAccess.kind, "allowed")
    if (shopAAccess.kind === "allowed" && shopBAccess.kind === "allowed") {
      assert.equal(shopAAccess.credentialSubjectId, shopBAccess.credentialSubjectId)
    }
  })

  it("keeps independent shop subjects distinct", () => {
    // Given: a fixture where each granted shop has a separate observed credential subject.
    const normalized = normalizeAuthorizationGrant({
      ...grantFixture(),
      subjects: [
        {
          credentialSubjectId: CredentialSubjectIdSchema.parse("60000000-0000-4000-8000-000000000011"),
          revision: 1,
          keyVersion: 1,
          shopIds: [shopA],
        },
        {
          credentialSubjectId: CredentialSubjectIdSchema.parse("60000000-0000-4000-8000-000000000012"),
          revision: 1,
          keyVersion: 1,
          shopIds: [shopB],
        },
      ],
    })

    // When: both shop bindings are resolved under the same organization.
    const resolvedA = authorizeShopCredentialBinding({ organizationId: organizationA, shopId: shopA }, normalized)
    const resolvedB = authorizeShopCredentialBinding({ organizationId: organizationA, shopId: shopB }, normalized)

    // Then: the contract keeps independent subjects independent.
    assert.equal(resolvedA.kind, "allowed")
    assert.equal(resolvedB.kind, "allowed")
    if (resolvedA.kind === "allowed" && resolvedB.kind === "allowed") {
      assert.notEqual(resolvedA.credentialSubjectId, resolvedB.credentialSubjectId)
    }
  })

  it("denies a foreign organization and an ungranted shop", () => {
    // Given: a grant scoped to organization A and shops A/B only.
    const normalized = grant()

    // When: a foreign organization and an unknown shop request a binding.
    const foreign = authorizeShopCredentialBinding({ organizationId: organizationB, shopId: shopA }, normalized)
    const missing = authorizeShopCredentialBinding({ organizationId: organizationA, shopId: ShopIdSchema.parse("30000000-0000-4000-8000-000000000003") }, normalized)

    // Then: neither path can access the credential subject.
    assert.deepEqual(foreign, { kind: "denied", reason: "grant_organization_mismatch" })
    assert.deepEqual(missing, { kind: "denied", reason: "shop_not_granted" })
  })

  it("rotates a shared subject once and preserves all bound shop ownership", () => {
    // Given: a shared active credential subject at revision one.
    const normalized = grant()
    const subjectId = CredentialSubjectIdSchema.parse("60000000-0000-4000-8000-000000000001")

    // When: worker recovery commits a rotation at the expected subject revision.
    const rotated = rotateCredentialSubject({
      grant: normalized,
      credentialSubjectId: subjectId,
      expectedRevision: 1,
      outcome: "rotated",
      keyVersion: 2,
    })

    // Then: one subject advances to revision two and remains bound to both shops.
    assert.equal(rotated.kind, "rotated")
    if (rotated.kind === "rotated") {
      assert.equal(rotated.subject.revision, 2)
      assert.deepEqual(rotated.subject.shopIds, [shopA, shopB])
    }
  })

  it("fails closed to reauthorization after a possible upstream rotation", () => {
    // Given: a selected credential subject whose upstream rotation may have succeeded before persistence failed.
    const normalized = grant()

    // When: recovery receives the unknown outcome without an official proof of the new token.
    const unknown = rotateCredentialSubject({
      grant: normalized,
      credentialSubjectId: CredentialSubjectIdSchema.parse("60000000-0000-4000-8000-000000000001"),
      expectedRevision: 1,
      outcome: "outcome_unknown",
      keyVersion: 1,
    })

    // Then: bindings are held for reauthorization instead of blind replay.
    assert.deepEqual(unknown, { kind: "reauth_required", reason: "rotation_outcome_unknown" })
  })
})

describe("worker-only exchange provider", () => {
  it("allows only the worker role to exchange a claimed callback through a provider fixture", async () => {
    // Given: a callback claim and a deterministic provider that returns no token material.
    const states = new InMemoryOAuthStateStore([stateRecord()])
    const claimed = claimOAuthCallback(
      { stateHash, organizationId: organizationA, actor: actorA, receivedAt: now, code: CallbackCodeSchema.parse("callback-code-canary"), shopId: shopeeShopId },
      states,
    )
    assert.equal(claimed.kind, "claimed")
    if (claimed.kind !== "claimed") return
    let invocationCount = 0
    const provider = {
      async exchange() {
        invocationCount += 1
        return { ...grantFixture(), authorizedShopId: claimed.claim.shopId }
      },
    }

    // When: the worker capability invokes the provider with the one-time callback claim.
    const normalized = await executeWorkerOnlyTokenExchange(
      { runtimeRole: "worker", policyVersion: RUNTIME_POLICY_VERSION, claim: claimed.claim },
      provider,
    )

    // Then: the fixture is normalized once without using real HTTP or credentials.
    assert.equal(invocationCount, 1)
    assert.equal(normalized.bindings.length, 2)
  })

  it("denies the web runtime before it can invoke the exchange provider", async () => {
    // Given: a valid callback claim and a provider that would expose a call if reached.
    const states = new InMemoryOAuthStateStore([stateRecord()])
    const claimed = claimOAuthCallback(
      { stateHash, organizationId: organizationA, actor: actorA, receivedAt: now, code: CallbackCodeSchema.parse("callback-code-canary"), shopId: shopeeShopId },
      states,
    )
    assert.equal(claimed.kind, "claimed")
    if (claimed.kind !== "claimed") return
    let invocationCount = 0
    const provider = {
      async exchange() {
        invocationCount += 1
        return { ...grantFixture(), authorizedShopId: claimed.claim.shopId }
      },
    }

    // When: web attempts to pass the claim to the worker-only exchange seam.
    const rejected = executeWorkerOnlyTokenExchange(
      { runtimeRole: "web", policyVersion: RUNTIME_POLICY_VERSION, claim: claimed.claim },
      provider,
    )

    // Then: capability denial occurs before the provider receives a call.
    await assert.rejects(rejected, RuntimeCapabilityDeniedError)
    assert.equal(invocationCount, 0)
  })
})
