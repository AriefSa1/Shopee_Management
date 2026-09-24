import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  executeWorkerOnlyTokenRefresh,
  type OfficialOAuthTokenRefreshProvider,
} from "./worker-refresh.ts"
import type {
  EncryptedCredentialEnvelope,
  OAuthDurableRepository,
  RefreshOutcome,
} from "./durable-contracts.ts"
import { KmsMarketSchema } from "./durable-contracts.ts"
import { CredentialSubjectIdSchema, OAuthRefreshTokenSchema, PartnerApplicationIdSchema } from "./model.ts"
import { OrganizationIdSchema } from "../../identity/src/model.ts"
import { RUNTIME_POLICY_VERSION } from "../../runtime-boundaries/src/runtime-boundaries.ts"

const organizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
const subjectId = CredentialSubjectIdSchema.parse("60000000-0000-4000-8000-000000000011")
const partnerApplicationId = PartnerApplicationIdSchema.parse("partner-worker-refresh")
const market = KmsMarketSchema.parse("ID")
const currentEnvelope: EncryptedCredentialEnvelope = {
  keyVersion: 7,
  ciphertext: "current-envelope",
  algorithm: "kms-envelope-v1",
}

function repository(options: { readonly failure?: "read" | "persist" } = {}): OAuthDurableRepository & {
  readonly outcomes: RefreshOutcome[]
} {
  const outcomes: RefreshOutcome[] = []
  return {
    outcomes,
    async saveAttempt() {},
    async getAttempt() { return undefined },
    async saveGrant() {},
    async getGrant() { return undefined },
    async saveSubject() {},
    async readEnvelope() {
      if (options.failure === "read") throw new Error("reauthentication required")
      return currentEnvelope
    },
    async recordRefreshOutcome(input) {
      const outcome: RefreshOutcome = options.failure === "persist"
        ? { kind: "denied", reason: "stale_credential_revision" }
        : input.outcome === "outcome_unknown"
          ? { kind: "reauth_required", reason: "refresh_outcome_unknown" }
          : { kind: "rotated", subject: { credentialSubjectId: subjectId, organizationId, revision: 2, keyVersion: input.envelope.keyVersion, status: "active", ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }) } }
      outcomes.push(outcome)
      return outcome
    },
  }
}

function kms(options: { readonly sealFailure?: boolean } = {}) {
  return {
    async unseal() { return OAuthRefreshTokenSchema.parse("refresh-token-current") },
    async seal() {
      if (options.sealFailure === true) throw new Error("kms unavailable")
      return { keyVersion: 8, ciphertext: "next-envelope", algorithm: "kms-envelope-v1" as const }
    },
  }
}

function request(runtimeRole: "worker" | "web" = "worker") {
  return {
    runtimeRole,
    policyVersion: RUNTIME_POLICY_VERSION,
    organizationId,
    partnerApplicationId,
    market,
    credentialSubjectId: subjectId,
    expectedRevision: 1,
    keyVersion: 8,
  }
}

describe("worker-only OAuth refresh orchestration", () => {
  it("unseals, refreshes, reseals, and persists one fenced rotation", async () => {
    const calls: string[] = []
    const provider: OfficialOAuthTokenRefreshProvider = {
      async refresh(input) {
        calls.push(input.refreshToken)
        return { refreshToken: OAuthRefreshTokenSchema.parse("refresh-token-next"), expiresAt: "2026-10-01T00:00:00.000Z" }
      },
    }
    const durable = repository()
    const result = await executeWorkerOnlyTokenRefresh(request(), { durable, kms: kms(), provider, now: () => "2026-09-10T00:00:00.000Z" })
    assert.equal(result.kind, "rotated")
    assert.deepEqual(calls, ["refresh-token-current"])
    assert.equal(durable.outcomes[0]?.kind, "rotated")
    assert.equal(durable.outcomes[0]?.kind === "rotated" ? durable.outcomes[0].subject.expiresAt : undefined, "2026-10-01T00:00:00.000Z")
  })

  it("maps a provider failure to durable outcome_unknown reauthentication", async () => {
    const provider: OfficialOAuthTokenRefreshProvider = {
      async refresh() { throw new Error("timeout after send") },
    }
    const durable = repository()
    const result = await executeWorkerOnlyTokenRefresh(request(), { durable, kms: kms(), provider, now: () => "2026-09-10T00:00:00.000Z" })
    assert.deepEqual(result, { kind: "reauth_required", outcome: { kind: "reauth_required", reason: "refresh_outcome_unknown" } })
    assert.equal(durable.outcomes.length, 1)
  })

  it("maps KMS sealing failure to the same no-blind-retry recovery path", async () => {
    const provider: OfficialOAuthTokenRefreshProvider = {
      async refresh() { return { refreshToken: OAuthRefreshTokenSchema.parse("refresh-token-next"), expiresAt: "2026-10-01T00:00:00.000Z" } },
    }
    const durable = repository()
    const result = await executeWorkerOnlyTokenRefresh(request(), { durable, kms: kms({ sealFailure: true }), provider, now: () => "2026-09-10T00:00:00.000Z" })
    assert.equal(result.kind, "reauth_required")
    assert.deepEqual(durable.outcomes[0], { kind: "reauth_required", reason: "refresh_outcome_unknown" })
  })

  it("denies web runtime before reading the envelope or calling the provider", async () => {
    let providerCalls = 0
    const durable = repository()
    await assert.rejects(
      executeWorkerOnlyTokenRefresh(request("web"), {
        durable,
        kms: kms(),
        provider: { async refresh() { providerCalls += 1; throw new Error("must not call") } },
        now: () => "2026-09-10T00:00:00.000Z",
      }),
      /Runtime capability denied/,
    )
    assert.equal(providerCalls, 0)
    assert.equal(durable.outcomes.length, 0)
  })
})
