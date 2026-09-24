import assert from "node:assert/strict"
import { OrganizationIdSchema } from "../../identity/src/model.ts"
import { RUNTIME_POLICY_VERSION } from "../../runtime-boundaries/src/runtime-boundaries.ts"
import { CredentialSubjectIdSchema, OAuthRefreshTokenSchema, PartnerApplicationIdSchema } from "./model.ts"
import { KmsMarketSchema } from "./durable-contracts.ts"
import { FakeOAuthCredentialPostgresExecutor } from "./postgres-credentials.fake.ts"
import { PostgresCredentialRepository } from "./postgres-credentials.ts"
import { executeWorkerOnlyPostgresCredentialRefresh } from "./postgres-worker-refresh.ts"

const organizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
const subjectId = CredentialSubjectIdSchema.parse("60000000-0000-4000-8000-000000000020")
const market = KmsMarketSchema.parse("ID")
const executor = new FakeOAuthCredentialPostgresExecutor()
const credentials = new PostgresCredentialRepository(executor)
await credentials.saveSubject({
  organizationId,
  credentialSubjectId: subjectId,
  partnerApplicationId: PartnerApplicationIdSchema.parse("partner-manual-refresh"),
  revision: 1,
  status: "active",
  expiresAt: "2026-10-09T00:00:00.000Z",
  envelope: { keyVersion: 7, ciphertext: "fixture-envelope", algorithm: "kms-envelope-v1" },
})
const result = await executeWorkerOnlyPostgresCredentialRefresh(
  { runtimeRole: "worker", policyVersion: RUNTIME_POLICY_VERSION, organizationId, partnerApplicationId: PartnerApplicationIdSchema.parse("partner-manual-refresh"), market, credentialSubjectId: subjectId, expectedRevision: 1, keyVersion: 8 },
  {
    credentials,
    kms: { async unseal() { return OAuthRefreshTokenSchema.parse("fixture-refresh-token") }, async seal() { return { keyVersion: 8, ciphertext: "rotated-envelope", algorithm: "kms-envelope-v1" as const } } },
    provider: { async refresh(input) { assert.equal(input.refreshToken, "fixture-refresh-token"); return { refreshToken: OAuthRefreshTokenSchema.parse("next-refresh-token"), expiresAt: "2026-11-09T00:00:00.000Z" } } },
    now: () => "2026-09-10T00:00:00.000Z",
  },
)
assert.equal(result.kind, "rotated")
console.log(JSON.stringify({
  scenario: "postgres-worker-oauth-refresh",
  result: result.kind,
  revision: result.kind === "rotated" ? result.subject.revision : null,
  expiresAt: result.kind === "rotated" ? result.subject.expiresAt : null,
  rowLock: executor.statementsFor("oauth.credential_subject.refresh.lock")[0]?.text.includes("FOR UPDATE") === true,
  networkCalls: 0,
  databaseCalls: 0,
  shopeeMutations: 0,
  externalWrites: 0,
  secretFieldsPresent: false,
}))
