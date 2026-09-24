import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { OrganizationIdSchema } from "../../identity/src/model.ts"
import { RUNTIME_POLICY_VERSION } from "../../runtime-boundaries/src/runtime-boundaries.ts"
import { CredentialSubjectIdSchema, OAuthRefreshTokenSchema, PartnerApplicationIdSchema } from "./model.ts"
import { FakeOAuthCredentialPostgresExecutor } from "./postgres-credentials.fake.ts"
import { PostgresCredentialRepository } from "./postgres-credentials.ts"
import { executeWorkerOnlyPostgresCredentialRefresh } from "./postgres-worker-refresh.ts"
import type { OfficialOAuthTokenRefreshProvider } from "./worker-refresh.ts"
import { KmsMarketSchema } from "./durable-contracts.ts"

const organizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
const subjectId = CredentialSubjectIdSchema.parse("60000000-0000-4000-8000-000000000020")
const market = KmsMarketSchema.parse("ID")
const envelope = { keyVersion: 7, ciphertext: "ciphertext-current", algorithm: "kms-envelope-v1" as const }
const subject = {
  organizationId,
  credentialSubjectId: subjectId,
  partnerApplicationId: PartnerApplicationIdSchema.parse("partner-worker-refresh"),
  revision: 1,
  status: "active" as const,
  expiresAt: "2026-10-09T00:00:00.000Z",
  envelope,
}

function request(runtimeRole: "worker" | "web" = "worker") {
  return {
    runtimeRole,
    policyVersion: RUNTIME_POLICY_VERSION,
    organizationId,
    partnerApplicationId: subject.partnerApplicationId,
    market,
    credentialSubjectId: subjectId,
    expectedRevision: 1,
    keyVersion: 8,
  }
}

function kms() {
  return {
    async unseal() { return OAuthRefreshTokenSchema.parse("refresh-token-current") },
    async seal() { return { keyVersion: 8, ciphertext: "ciphertext-next", algorithm: "kms-envelope-v1" as const } },
  }
}

describe("PostgreSQL worker-only OAuth refresh", () => {
  it("persists a fenced rotation and provider expiry through the PostgreSQL repository", async () => {
    const executor = new FakeOAuthCredentialPostgresExecutor()
    const credentials = new PostgresCredentialRepository(executor)
    await credentials.saveSubject(subject)
    const provider: OfficialOAuthTokenRefreshProvider = {
      async refresh(input) {
        assert.equal(input.refreshToken, "refresh-token-current")
        return { refreshToken: OAuthRefreshTokenSchema.parse("refresh-token-next"), expiresAt: "2026-11-09T00:00:00.000Z" }
      },
    }
    const result = await executeWorkerOnlyPostgresCredentialRefresh(request(), {
      credentials,
      kms: kms(),
      provider,
      now: () => "2026-09-10T00:00:00.000Z",
    })
    assert.equal(result.kind, "rotated")
    if (result.kind === "rotated") {
      assert.equal(result.subject.revision, 2)
      assert.equal(result.subject.expiresAt, "2026-11-09T00:00:00.000Z")
    }
    assert.match(executor.statementsFor("oauth.credential_subject.refresh.lock")[0]?.text ?? "", /FOR UPDATE/)
    assert.match(executor.statementsFor("oauth.credential_subject.rotate")[0]?.text ?? "", /expires_at = COALESCE/)
  })

  it("fences provider uncertainty as reauthentication and blocks the envelope", async () => {
    const executor = new FakeOAuthCredentialPostgresExecutor()
    const credentials = new PostgresCredentialRepository(executor)
    await credentials.saveSubject(subject)
    const provider: OfficialOAuthTokenRefreshProvider = { async refresh() { throw new Error("timeout after send") } }
    const result = await executeWorkerOnlyPostgresCredentialRefresh(request(), {
      credentials,
      kms: kms(),
      provider,
      now: () => "2026-09-10T00:00:00.000Z",
    })
    assert.deepEqual(result, { kind: "reauth_required", reason: "refresh_outcome_unknown" })
    await assert.rejects(credentials.readEnvelope(organizationId, subjectId), /reauthentication required/)
  })

  it("denies web runtime before PostgreSQL or provider access", async () => {
    const executor = new FakeOAuthCredentialPostgresExecutor()
    const credentials = new PostgresCredentialRepository(executor)
    await credentials.saveSubject(subject)
    const statementCount = executor.statements.length
    let providerCalls = 0
    await assert.rejects(
      executeWorkerOnlyPostgresCredentialRefresh(request("web"), {
        credentials,
        kms: kms(),
        provider: { async refresh() { providerCalls += 1; throw new Error("must not call") } },
        now: () => "2026-09-10T00:00:00.000Z",
      }),
      /Runtime capability denied/,
    )
    assert.equal(providerCalls, 0)
    assert.equal(executor.statements.length, statementCount)
  })

  it("still refreshes when the stored expiry has lapsed so the provider can validate the refresh token", async () => {
    // The persisted expires_at tracks an access-token style window; a lapsed value
    // must not block the refresh that renews it. Shopee remains the authority on
    // whether the refresh token itself is still valid.
    const executor = new FakeOAuthCredentialPostgresExecutor()
    const credentials = new PostgresCredentialRepository(executor)
    await credentials.saveSubject({ ...subject, expiresAt: "2026-09-09T00:00:00.000Z" })
    let providerCalls = 0
    let unsealCalls = 0
    const result = await executeWorkerOnlyPostgresCredentialRefresh(request(), {
      credentials,
      kms: { ...kms(), async unseal() { unsealCalls += 1; return OAuthRefreshTokenSchema.parse("refresh-token-current") } },
      provider: { async refresh() { providerCalls += 1; return { refreshToken: OAuthRefreshTokenSchema.parse("refresh-token-next"), expiresAt: "2026-11-09T00:00:00.000Z" } } },
      now: () => "2026-09-10T00:00:00.000Z",
    })
    assert.equal(result.kind, "rotated")
    if (result.kind === "rotated") {
      assert.equal(result.subject.revision, 2)
      assert.equal(result.subject.expiresAt, "2026-11-09T00:00:00.000Z")
    }
    assert.equal(unsealCalls, 1)
    assert.equal(providerCalls, 1)
  })

  it("serializes same-revision refreshes so only one provider call proceeds", async () => {
    const executor = new FakeOAuthCredentialPostgresExecutor()
    const credentials = new PostgresCredentialRepository(executor)
    await credentials.saveSubject(subject)
    let providerCalls = 0
    let releaseProvider: (() => void) | undefined
    let providerStarted: (() => void) | undefined
    const providerReady = new Promise<void>((resolve) => { providerStarted = resolve })
    const providerRelease = new Promise<void>((resolve) => { releaseProvider = resolve })
    const provider: OfficialOAuthTokenRefreshProvider = {
      async refresh() {
        providerCalls += 1
        providerStarted?.()
        await providerRelease
        return { refreshToken: OAuthRefreshTokenSchema.parse("refresh-token-next"), expiresAt: "2026-11-09T00:00:00.000Z" }
      },
    }
    const first = executeWorkerOnlyPostgresCredentialRefresh(request(), { credentials, kms: kms(), provider, now: () => "2026-09-10T00:00:00.000Z" })
    await providerReady
    const second = executeWorkerOnlyPostgresCredentialRefresh(request(), { credentials, kms: kms(), provider, now: () => "2026-09-10T00:00:00.000Z" })
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.equal(providerCalls, 1)
    releaseProvider?.()
    const results = await Promise.all([first, second])
    assert.equal(results.filter((result) => result.kind === "rotated").length, 1)
    assert.deepEqual(results.find((result) => result.kind === "denied"), { kind: "denied", reason: "stale_credential_revision" })
  })
})
