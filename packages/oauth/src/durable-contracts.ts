import type {
  AuthorizationGrantFixture,
  AuthorizationGrantId,
  CallbackCode,
  CredentialSubjectId,
  OAuthRefreshToken,
  OAuthAttemptId,
  OAuthStateHash,
  PartnerApplicationId,
} from "./model.ts"
import {
  AuthorizationGrantFixtureSchema,
  CredentialSubjectIdSchema,
  OAuthAttemptIdSchema,
  OAuthStateHashSchema,
  PartnerApplicationIdSchema,
} from "./model.ts"
import type { Identity, OrganizationId } from "../../identity/src/model.ts"
import { z } from "zod"

export const KmsMarketSchema = z.string().regex(/^[A-Z]{2}$/).brand("KmsMarket")
export type KmsMarket = z.infer<typeof KmsMarketSchema>

export const KmsEncryptionContextSchema = z.discriminatedUnion("purpose", [
  z.object({
    purpose: z.literal("oauth_callback_code"),
    organizationId: z.string().uuid(),
    partnerApplicationId: z.string().trim().min(1).max(128),
    market: KmsMarketSchema,
  }).strict(),
  z.object({
    purpose: z.literal("oauth_refresh_token"),
    organizationId: z.string().uuid(),
    partnerApplicationId: z.string().trim().min(1).max(128),
    credentialSubjectId: z.string().uuid(),
    market: KmsMarketSchema,
  }).strict(),
])

export type KmsEncryptionContext = z.infer<typeof KmsEncryptionContextSchema>

export type OAuthAttemptRecord = {
  readonly attemptId: OAuthAttemptId
  readonly organizationId: OrganizationId
  readonly actor: Identity
  readonly partnerApplicationId: PartnerApplicationId
  readonly stateHash: OAuthStateHash
  readonly status: "issued" | "claimed" | "expired"
  readonly issuedAt: string
  readonly expiresAt: string
}

export type DurableCredentialSubject = {
  readonly credentialSubjectId: CredentialSubjectId
  readonly organizationId: OrganizationId
  readonly revision: number
  readonly keyVersion: number
  readonly status: "active" | "reauth_required"
  readonly expiresAt?: string
}

export type EncryptedCredentialEnvelope = {
  readonly keyVersion: number
  readonly ciphertext: string
  readonly algorithm: "kms-envelope-v1"
}

export type KmsPlaintext = CallbackCode | OAuthRefreshToken

export interface KmsEnvelopeCodec {
  seal(plaintext: KmsPlaintext, keyVersion: number, context: KmsEncryptionContext): Promise<EncryptedCredentialEnvelope>
  unseal(envelope: EncryptedCredentialEnvelope, context: KmsEncryptionContext): Promise<KmsPlaintext>
}

export type RefreshOutcome =
  | {
      readonly kind: "rotated"
      readonly subject: DurableCredentialSubject
    }
  | { readonly kind: "reauth_required"; readonly reason: "refresh_outcome_unknown" }
  | { readonly kind: "denied"; readonly reason: "credential_subject_not_found" | "stale_credential_revision" }

export type RefreshPersistenceRequest = {
  readonly organizationId: OrganizationId
  readonly credentialSubjectId: CredentialSubjectId
  readonly expectedRevision: number
  readonly outcome: "rotated" | "outcome_unknown"
  readonly envelope: EncryptedCredentialEnvelope
  readonly expiresAt?: string
}

export interface OAuthDurableRepository {
  saveAttempt(record: OAuthAttemptRecord): Promise<void>
  getAttempt(organizationId: OrganizationId, attemptId: OAuthAttemptId): Promise<OAuthAttemptRecord | undefined>
  saveGrant(grant: AuthorizationGrantFixture): Promise<void>
  getGrant(organizationId: OrganizationId, grantId: AuthorizationGrantId): Promise<AuthorizationGrantFixture | undefined>
  saveSubject(subject: DurableCredentialSubject): Promise<void>
  recordRefreshOutcome(request: RefreshPersistenceRequest): Promise<RefreshOutcome>
  readEnvelope(organizationId: OrganizationId, subjectId: CredentialSubjectId): Promise<EncryptedCredentialEnvelope>
}

export class OAuthReauthenticationRequiredError extends Error {
  readonly name = "OAuthReauthenticationRequiredError"
  readonly subjectId: CredentialSubjectId

  constructor(subjectId: CredentialSubjectId) {
    super("reauthentication required before credential envelope access")
    this.subjectId = subjectId
  }
}

export class InMemoryOAuthDurableRepository implements OAuthDurableRepository {
  private readonly attempts = new Map<OAuthAttemptId, OAuthAttemptRecord>()
  private readonly grants = new Map<AuthorizationGrantId, AuthorizationGrantFixture>()
  private readonly subjects = new Map<CredentialSubjectId, DurableCredentialSubject>()
  private readonly envelopes = new Map<CredentialSubjectId, EncryptedCredentialEnvelope>()

  async saveAttempt(record: OAuthAttemptRecord): Promise<void> {
    const attemptId = OAuthAttemptIdSchema.parse(record.attemptId)
    const organizationId = record.organizationId
    const actor = record.actor
    const partnerApplicationId = PartnerApplicationIdSchema.parse(record.partnerApplicationId)
    const stateHash = OAuthStateHashSchema.parse(record.stateHash)
    const safeRecord: OAuthAttemptRecord = {
      attemptId,
      organizationId,
      actor,
      partnerApplicationId,
      stateHash,
      status: record.status,
      issuedAt: record.issuedAt,
      expiresAt: record.expiresAt,
    }
    this.attempts.set(attemptId, safeRecord)
  }

  async getAttempt(organizationId: OrganizationId, attemptId: OAuthAttemptId): Promise<OAuthAttemptRecord | undefined> {
    const record = this.attempts.get(attemptId)
    return record?.organizationId === organizationId ? record : undefined
  }

  async saveGrant(grant: AuthorizationGrantFixture): Promise<void> {
    const parsed = AuthorizationGrantFixtureSchema.parse(grant)
    this.grants.set(parsed.grantId, parsed)
  }

  async getGrant(organizationId: OrganizationId, grantId: AuthorizationGrantId): Promise<AuthorizationGrantFixture | undefined> {
    const grant = this.grants.get(grantId)
    return grant?.organizationId === organizationId ? grant : undefined
  }

  async saveSubject(subject: DurableCredentialSubject): Promise<void> {
    const credentialSubjectId = CredentialSubjectIdSchema.parse(subject.credentialSubjectId)
    this.subjects.set(credentialSubjectId, { ...subject, credentialSubjectId })
  }

  async recordRefreshOutcome(request: RefreshPersistenceRequest): Promise<RefreshOutcome> {
    const subject = this.subjects.get(request.credentialSubjectId)
    if (subject === undefined || subject.organizationId !== request.organizationId) {
      return { kind: "denied", reason: "credential_subject_not_found" }
    }
    if (subject.revision !== request.expectedRevision) {
      return { kind: "denied", reason: "stale_credential_revision" }
    }
    switch (request.outcome) {
      case "rotated": {
        const nextSubject: DurableCredentialSubject = {
          ...subject,
          revision: subject.revision + 1,
          keyVersion: request.envelope.keyVersion,
          status: "active",
          ...(request.expiresAt === undefined ? {} : { expiresAt: request.expiresAt }),
        }
        this.subjects.set(subject.credentialSubjectId, nextSubject)
        this.envelopes.set(subject.credentialSubjectId, request.envelope)
        return { kind: "rotated", subject: nextSubject }
      }
      case "outcome_unknown":
        this.subjects.set(subject.credentialSubjectId, { ...subject, status: "reauth_required" })
        this.envelopes.delete(subject.credentialSubjectId)
        return { kind: "reauth_required", reason: "refresh_outcome_unknown" }
      default:
        return assertNever(request.outcome)
    }
  }

  async readEnvelope(organizationId: OrganizationId, subjectId: CredentialSubjectId): Promise<EncryptedCredentialEnvelope> {
    const subject = this.subjects.get(subjectId)
    if (subject?.organizationId !== organizationId || subject.status !== "active") {
      throw new OAuthReauthenticationRequiredError(subjectId)
    }
    const envelope = this.envelopes.get(subjectId)
    if (envelope === undefined) throw new OAuthReauthenticationRequiredError(subjectId)
    return envelope
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unhandled refresh outcome: ${String(value)}`)
}
