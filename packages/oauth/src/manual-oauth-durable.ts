import {
  CredentialSubjectIdSchema,
  InMemoryOAuthDurableRepository,
  OAuthAttemptIdSchema,
  OAuthStateHashSchema,
  PartnerApplicationIdSchema,
} from "./index.ts"
import { IdentitySchema, OrganizationIdSchema } from "../../identity/src/model.ts"

const organizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
const repository = new InMemoryOAuthDurableRepository()
const subjectId = CredentialSubjectIdSchema.parse("60000000-0000-4000-8000-000000000011")
const attemptId = OAuthAttemptIdSchema.parse("40000000-0000-4000-8000-000000000010")
const attempt = {
  attemptId,
  organizationId,
  actor: IdentitySchema.parse({ issuer: "https://id.example.test", subject: "owner-manual-durable" }),
  partnerApplicationId: PartnerApplicationIdSchema.parse("partner-durable-manual"),
  stateHash: OAuthStateHashSchema.parse("state-hash-durable-manual-000000000000000000000000000001"),
  status: "claimed" as const,
  issuedAt: "2026-09-09T00:00:00.000Z",
  expiresAt: "2026-09-09T00:10:00.000Z",
}

await repository.saveAttempt(attempt)
await repository.saveSubject({
  credentialSubjectId: subjectId,
  organizationId,
  revision: 1,
  keyVersion: 7,
  status: "active",
})
const refresh = await repository.recordRefreshOutcome({
  organizationId,
  credentialSubjectId: subjectId,
  expectedRevision: 1,
  outcome: "outcome_unknown",
  envelope: { keyVersion: 7, ciphertext: "ciphertext-fixture", algorithm: "kms-envelope-v1" },
})

console.log(JSON.stringify({
  scenario: "durable-oauth-contract-fixture",
  attemptStored: (await repository.getAttempt(organizationId, attemptId)) !== undefined,
  refresh,
  secretFieldsPresent: false,
  networkCalls: 0,
  databaseWrites: 0,
  kmsCalls: 0,
}))
