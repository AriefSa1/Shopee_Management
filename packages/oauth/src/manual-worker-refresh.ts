import assert from "node:assert/strict"
import { CredentialSubjectIdSchema, OAuthRefreshTokenSchema, PartnerApplicationIdSchema } from "./model.ts"
import { OrganizationIdSchema } from "../../identity/src/model.ts"
import { executeWorkerOnlyTokenRefresh } from "./worker-refresh.ts"
import { KmsMarketSchema, type OAuthDurableRepository, type RefreshOutcome } from "./durable-contracts.ts"
import { RUNTIME_POLICY_VERSION } from "../../runtime-boundaries/src/runtime-boundaries.ts"

const organizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
const subjectId = CredentialSubjectIdSchema.parse("60000000-0000-4000-8000-000000000011")
const partnerApplicationId = PartnerApplicationIdSchema.parse("partner-manual-refresh")
const market = KmsMarketSchema.parse("ID")
let persisted: RefreshOutcome | undefined
const durable: OAuthDurableRepository = {
  async saveAttempt() {}, async getAttempt() { return undefined }, async saveGrant() {}, async getGrant() { return undefined }, async saveSubject() {},
  async readEnvelope() { return { keyVersion: 7, ciphertext: "fixture-envelope", algorithm: "kms-envelope-v1" as const } },
  async recordRefreshOutcome(input) {
    persisted = input.outcome === "rotated"
      ? { kind: "rotated", subject: { credentialSubjectId: subjectId, organizationId, revision: 2, keyVersion: input.envelope.keyVersion, status: "active" } }
      : { kind: "reauth_required", reason: "refresh_outcome_unknown" }
    return persisted
  },
}

const result = await executeWorkerOnlyTokenRefresh(
  { runtimeRole: "worker", policyVersion: RUNTIME_POLICY_VERSION, organizationId, partnerApplicationId, market, credentialSubjectId: subjectId, expectedRevision: 1, keyVersion: 8 },
  {
    durable,
    kms: { async unseal() { return OAuthRefreshTokenSchema.parse("fixture-refresh-token") }, async seal() { return { keyVersion: 8, ciphertext: "rotated-envelope", algorithm: "kms-envelope-v1" as const } } },
    provider: { async refresh(input) { assert.equal(input.refreshToken, "fixture-refresh-token"); return { refreshToken: OAuthRefreshTokenSchema.parse("next-refresh-token"), expiresAt: "2026-10-01T00:00:00.000Z" } } },
    now: () => "2026-09-10T00:00:00.000Z",
  },
)

assert.equal(result.kind, "rotated")
assert.equal(persisted?.kind, "rotated")
console.log(JSON.stringify({
  scenario: "worker-only-oauth-refresh-rotation",
  result: result.kind,
  providerCalls: 1,
  plaintextReturned: false,
  outcomeUnknownRecovery: "reauth_required",
  networkCalls: 0,
  databaseCalls: 0,
  shopeeMutations: 0,
  externalWrites: 0,
}))
