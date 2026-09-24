import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { OrganizationIdSchema, ShopIdSchema } from "../../identity/src/model.ts"
import { CredentialSubjectIdSchema, PartnerApplicationIdSchema } from "./model.ts"
import { FakeOAuthCredentialPostgresExecutor } from "./postgres-credentials.fake.ts"
import { OAuthCredentialReauthenticationRequiredError, PostgresCredentialRepository } from "./postgres-credentials.ts"

const organizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
const otherOrganizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000009")
const subjectId = CredentialSubjectIdSchema.parse("60000000-0000-4000-8000-000000000020")
const shopId = ShopIdSchema.parse("30000000-0000-4000-8000-000000000020")
const envelope = { keyVersion: 7, ciphertext: "ciphertext-fixture", algorithm: "kms-envelope-v1" as const }
const subject = { organizationId, credentialSubjectId: subjectId, partnerApplicationId: PartnerApplicationIdSchema.parse("partner-credentials"), revision: 1, status: "active" as const, expiresAt: "2026-10-09T00:00:00.000Z", envelope }

describe("PostgreSQL credential subject persistence contract", () => {
  it("persists only organization-scoped encrypted envelope metadata", async () => {
    const executor = new FakeOAuthCredentialPostgresExecutor(); const repository = new PostgresCredentialRepository(executor)
    await repository.saveSubject(subject)
    assert.deepEqual(await repository.readEnvelope(organizationId, subjectId), envelope)
    assert.equal(executor.statements.flatMap((statement) => statement.params).includes("raw-token-fixture"), false)
    assert.equal(executor.statementsFor("oauth.credential_subject.insert").length, 1)
  })

  it("rotates under a row lock and fences stale revisions", async () => {
    const executor = new FakeOAuthCredentialPostgresExecutor(); const repository = new PostgresCredentialRepository(executor)
    await repository.saveSubject(subject)
    const rotated = await repository.recordRefreshOutcome({ organizationId, credentialSubjectId: subjectId, expectedRevision: 1, outcome: "rotated", envelope: { ...envelope, keyVersion: 8, ciphertext: "ciphertext-rotated" }, expiresAt: "2026-11-09T00:00:00.000Z", updatedAt: "2026-09-09T01:00:00.000Z" })
    assert.equal(rotated.kind, "rotated"); if (rotated.kind === "rotated") assert.equal(rotated.subject.revision, 2)
    if (rotated.kind === "rotated") assert.equal(rotated.subject.expiresAt, "2026-11-09T00:00:00.000Z")
    assert.deepEqual(await repository.recordRefreshOutcome({ organizationId, credentialSubjectId: subjectId, expectedRevision: 1, outcome: "rotated", envelope, updatedAt: "2026-09-09T01:01:00.000Z" }), { kind: "denied", reason: "stale_credential_revision" })
    assert.match(executor.statementsFor("oauth.credential_subject.refresh.lock")[0]?.text ?? "", /FOR UPDATE/)
  })

  it("marks outcome unknown as reauth required and propagates the block to bindings", async () => {
    const executor = new FakeOAuthCredentialPostgresExecutor(); const repository = new PostgresCredentialRepository(executor)
    await repository.saveSubject(subject); await repository.bindShop({ organizationId, shopId, credentialSubjectId: subjectId, status: "active" })
    const decision = await repository.recordRefreshOutcome({ organizationId, credentialSubjectId: subjectId, expectedRevision: 1, outcome: "outcome_unknown", updatedAt: "2026-09-09T01:00:00.000Z" })
    assert.deepEqual(decision, { kind: "reauth_required", reason: "refresh_outcome_unknown" })
    await assert.rejects(repository.readEnvelope(organizationId, subjectId), OAuthCredentialReauthenticationRequiredError)
    assert.equal(executor.bindingRows()[0]?.["status"], "reauth_required")
  })

  it("fails closed for foreign organizations, missing subjects, and inactive bindings", async () => {
    const executor = new FakeOAuthCredentialPostgresExecutor(); const repository = new PostgresCredentialRepository(executor)
    await repository.saveSubject(subject)
    await assert.rejects(repository.readEnvelope(otherOrganizationId, subjectId), OAuthCredentialReauthenticationRequiredError)
    await assert.rejects(repository.bindShop({ organizationId: otherOrganizationId, shopId, credentialSubjectId: subjectId, status: "active" }), OAuthCredentialReauthenticationRequiredError)
    await assert.rejects(repository.bindShop({ organizationId, shopId, credentialSubjectId: CredentialSubjectIdSchema.parse("60000000-0000-4000-8000-000000000021"), status: "active" }), OAuthCredentialReauthenticationRequiredError)
  })

  it("proves migration composite bindings and excludes plaintext secret columns", () => {
    const migration = readFileSync(new URL("../../../db/migrations/0005_credentials.sql", import.meta.url), "utf8")
    assert.match(migration, /PRIMARY KEY \(organization_id, credential_subject_id\)/)
    assert.match(migration, /PRIMARY KEY \(organization_id, shop_id, credential_subject_id\)/)
    assert.match(migration, /FOREIGN KEY \(organization_id, credential_subject_id\)/)
    assert.doesNotMatch(migration, /access_token|refresh_token|plaintext|raw_token|callback_code/i)
    assert.match(migration, /envelope_ciphertext text NOT NULL/)
  })

  it("reads a subject whose bigint revision arrives as a string from pg", async () => {
    // `pg` returns bigint columns (e.g. credential_subjects.revision) as decimal strings.
    const key = `${organizationId}:${subjectId}`
    const seeded = new Map([[key, {
      organization_id: organizationId,
      credential_subject_id: subjectId,
      partner_application_id: "partner-credentials",
      revision: "1",
      key_version: 7,
      envelope_algorithm: "kms-envelope-v1",
      envelope_ciphertext: "ciphertext-fixture",
      expires_at: "2026-10-09T00:00:00.000Z",
      status: "active",
    }]])
    const executor = new FakeOAuthCredentialPostgresExecutor(seeded)
    const repository = new PostgresCredentialRepository(executor)
    assert.deepEqual(await repository.readEnvelope(organizationId, subjectId), envelope)
  })
})
