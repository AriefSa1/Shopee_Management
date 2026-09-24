import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  InMemoryOAuthDurableRepository,
  type EncryptedCredentialEnvelope,
  type OAuthAttemptRecord,
} from "./durable-contracts.ts"
import {
  AuthorizationGrantFixtureSchema,
  CredentialSubjectIdSchema,
  OAuthAttemptIdSchema,
  OAuthStateHashSchema,
  PartnerApplicationIdSchema,
} from "./model.ts"
import { IdentitySchema, OrganizationIdSchema } from "../../identity/src/model.ts"

const organizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
const actor = IdentitySchema.parse({ issuer: "https://id.example.test", subject: "owner-durable" })
const attemptId = OAuthAttemptIdSchema.parse("40000000-0000-4000-8000-000000000010")

function attempt(): OAuthAttemptRecord {
  return {
    attemptId,
    organizationId,
    actor,
    partnerApplicationId: PartnerApplicationIdSchema.parse("partner-durable"),
    stateHash: OAuthStateHashSchema.parse("state-hash-durable-000000000000000000000000000001"),
    status: "claimed",
    issuedAt: "2026-09-09T00:00:00.000Z",
    expiresAt: "2026-09-09T00:10:00.000Z",
  }
}

describe("durable OAuth repository contracts", () => {
  it("stores and retrieves attempts by organization without callback secrets", async () => {
    // Given: an organization-owned claimed attempt with only a state hash.
    const repository = new InMemoryOAuthDurableRepository()

    // When: the attempt is persisted and read back under its owner.
    await repository.saveAttempt(attempt())
    const stored = await repository.getAttempt(organizationId, attemptId)

    // Then: durable projection preserves ownership and never adds raw callback material.
    assert.equal(stored?.organizationId, organizationId)
    assert.equal(stored?.stateHash, attempt().stateHash)
    assert.equal("callbackCode" in (stored ?? {}), false)
  })

  it("omits runtime-only callback fields from the durable attempt projection", async () => {
    // Given: an attempt-shaped runtime object carrying a callback code that must never persist.
    const repository = new InMemoryOAuthDurableRepository()
    const runtimeAttempt = { ...attempt(), callbackCode: "raw-callback-code" }

    // When: the runtime object is saved through the durable boundary.
    await repository.saveAttempt(runtimeAttempt)
    const stored = await repository.getAttempt(organizationId, attemptId)

    // Then: the durable record contains only the explicit safe attempt fields.
    assert.deepEqual(Object.keys(stored ?? {}).sort(), [
      "actor",
      "attemptId",
      "expiresAt",
      "issuedAt",
      "organizationId",
      "partnerApplicationId",
      "stateHash",
      "status",
    ])
    assert.equal("callbackCode" in (stored ?? {}), false)
  })

  it("rejects a foreign organization read and preserves grant binding", async () => {
    // Given: a grant and subject owned by organization A.
    const repository = new InMemoryOAuthDurableRepository()
    const grant = AuthorizationGrantFixtureSchema.parse({
      grantId: "50000000-0000-4000-8000-000000000010",
      organizationId,
      partnerApplicationId: "partner-durable",
      grantKind: "main_account",
      grantedAt: "2026-09-09T00:05:00.000Z",
      subjects: [{
        credentialSubjectId: "60000000-0000-4000-8000-000000000010",
        revision: 1,
        keyVersion: 1,
        shopIds: ["30000000-0000-4000-8000-000000000010"],
      }],
    })
    await repository.saveGrant(grant)
    const foreignOrg = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000002")

    // When: organization B attempts to read the grant.
    const foreignRead = await repository.getGrant(foreignOrg, grant.grantId)
    const ownedRead = await repository.getGrant(organizationId, grant.grantId)

    // Then: cross-organization access is absent and owner read keeps the subject relationship.
    assert.equal(foreignRead, undefined)
    assert.equal(ownedRead?.subjects[0]?.shopIds.length, 1)
  })

  it("maps unknown refresh outcome to reauthorization and rejects envelope reuse", async () => {
    // Given: one active subject and an encrypted envelope with a KMS key version.
    const repository = new InMemoryOAuthDurableRepository()
    const subject = {
      credentialSubjectId: CredentialSubjectIdSchema.parse("60000000-0000-4000-8000-000000000011"),
      organizationId,
      revision: 1,
      keyVersion: 7,
      status: "active" as const,
    }
    const envelope: EncryptedCredentialEnvelope = {
      keyVersion: 7,
      ciphertext: "ciphertext-fixture",
      algorithm: "kms-envelope-v1",
    }
    await repository.saveSubject(subject)

    // When: refresh persistence reports that the provider outcome is unknown.
    const decision = await repository.recordRefreshOutcome({
      organizationId,
      credentialSubjectId: subject.credentialSubjectId,
      expectedRevision: 1,
      outcome: "outcome_unknown",
      envelope,
    })

    // Then: the subject requires reauthorization and the envelope cannot be read as plaintext.
    assert.deepEqual(decision, { kind: "reauth_required", reason: "refresh_outcome_unknown" })
    await assert.rejects(repository.readEnvelope(organizationId, subject.credentialSubjectId), /reauthentication required/)
  })
})
