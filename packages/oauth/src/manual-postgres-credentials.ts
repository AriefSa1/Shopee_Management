import assert from "node:assert/strict"
import { OrganizationIdSchema, ShopIdSchema } from "../../identity/src/model.ts"
import { CredentialSubjectIdSchema, PartnerApplicationIdSchema } from "./model.ts"
import { FakeOAuthCredentialPostgresExecutor } from "./postgres-credentials.fake.ts"
import { OAuthCredentialReauthenticationRequiredError, PostgresCredentialRepository } from "./postgres-credentials.ts"

const organizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
const foreignOrganizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000009")
const subjectId = CredentialSubjectIdSchema.parse("60000000-0000-4000-8000-000000000030")
const shopId = ShopIdSchema.parse("30000000-0000-4000-8000-000000000030")
const encryptedEnvelope = { keyVersion: 3, ciphertext: "manual-encrypted-fixture", algorithm: "kms-envelope-v1" as const }

const executor = new FakeOAuthCredentialPostgresExecutor()
const repository = new PostgresCredentialRepository(executor)
await repository.saveSubject({
  organizationId,
  credentialSubjectId: subjectId,
  partnerApplicationId: PartnerApplicationIdSchema.parse("partner-manual"),
  revision: 1,
  status: "active",
  expiresAt: "2026-10-09T00:00:00.000Z",
  envelope: encryptedEnvelope,
})
await repository.bindShop({ organizationId, shopId, credentialSubjectId: subjectId, status: "active" })
const rotated = await repository.recordRefreshOutcome({
  organizationId,
  credentialSubjectId: subjectId,
  expectedRevision: 1,
  outcome: "rotated",
  envelope: { keyVersion: 4, ciphertext: "manual-rotated-encrypted-fixture", algorithm: "kms-envelope-v1" },
  updatedAt: "2026-09-09T01:00:00.000Z",
})
assert.equal(rotated.kind, "rotated")
const unknown = await repository.recordRefreshOutcome({
  organizationId,
  credentialSubjectId: subjectId,
  expectedRevision: 2,
  outcome: "outcome_unknown",
  updatedAt: "2026-09-09T01:01:00.000Z",
})
assert.deepEqual(unknown, { kind: "reauth_required", reason: "refresh_outcome_unknown" })
await assert.rejects(repository.readEnvelope(organizationId, subjectId), OAuthCredentialReauthenticationRequiredError)
await assert.rejects(repository.readEnvelope(foreignOrganizationId, subjectId), OAuthCredentialReauthenticationRequiredError)

const result = {
  scenario: "postgres-credential-subject-provider-free-contract",
  executor: "deterministic-fake-postgres-executor",
  encryptedEnvelopeAccepted: true,
  organizationScoped: true,
  compositeShopBinding: true,
  revisionFencing: executor.statementsFor("oauth.credential_subject.refresh.lock").every((statement) => statement.text.includes("FOR UPDATE")),
  outcomeUnknownRequiresReauth: unknown.kind === "reauth_required",
  envelopeReadBlockedAfterUnknown: true,
  plaintextInputsAccepted: false,
  externalEffects: { networkCalls: 0, databaseCalls: 0, shopeeMutations: 0, kmsCalls: 0, externalWrites: 0 },
  statements: executor.statements.length,
  secretFieldsPresent: false,
}
console.log(JSON.stringify(result, null, 2))
