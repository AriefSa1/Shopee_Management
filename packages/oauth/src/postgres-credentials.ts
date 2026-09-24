import { z } from "zod"
import type { OrganizationId, ShopId } from "../../identity/src/model.ts"
import { OrganizationIdSchema, ShopIdSchema } from "../../identity/src/model.ts"
import type { PostgresExecutor, SqlRow } from "../../delivery/src/postgres-delivery.ts"
import {
  CredentialSubjectIdSchema,
  PartnerApplicationIdSchema,
  type CredentialSubjectId,
  type PartnerApplicationId,
} from "./model.ts"
import type { EncryptedCredentialEnvelope } from "./durable-contracts.ts"

export const EncryptedCredentialEnvelopeSchema = z.object({
  keyVersion: z.number().int().positive(),
  ciphertext: z.string().trim().min(1).max(16_384),
  algorithm: z.literal("kms-envelope-v1"),
}).strict().readonly()

export type CredentialSubjectRecord = {
  readonly organizationId: OrganizationId
  readonly credentialSubjectId: CredentialSubjectId
  readonly partnerApplicationId: PartnerApplicationId
  readonly revision: number
  readonly status: "active" | "reauth_required"
  readonly expiresAt: string
  readonly envelope: EncryptedCredentialEnvelope
}

export type ShopCredentialBindingRecord = {
  readonly organizationId: OrganizationId
  readonly shopId: ShopId
  readonly credentialSubjectId: CredentialSubjectId
  readonly status: "active" | "reauth_required"
}

export type CredentialRefreshRequest = {
  readonly organizationId: OrganizationId
  readonly credentialSubjectId: CredentialSubjectId
  readonly expectedRevision: number
  readonly outcome: "rotated" | "outcome_unknown"
  readonly envelope?: EncryptedCredentialEnvelope
  readonly expiresAt?: string
  readonly updatedAt: string
}

export type CredentialRefreshDecision =
  | { readonly kind: "rotated"; readonly subject: CredentialSubjectRecord }
  | { readonly kind: "reauth_required"; readonly reason: "refresh_outcome_unknown" }
  | { readonly kind: "denied"; readonly reason: "credential_subject_not_found" | "stale_credential_revision" | "credential_subject_expired" }

export type CredentialRefreshLeaseResult =
  | { readonly outcome: "rotated"; readonly envelope: EncryptedCredentialEnvelope; readonly expiresAt: string }
  | { readonly outcome: "outcome_unknown" }
  | { readonly outcome: "denied"; readonly reason: "credential_subject_expired" }

export class OAuthCredentialReauthenticationRequiredError extends Error {
  readonly name = "OAuthCredentialReauthenticationRequiredError"
  readonly subjectId: CredentialSubjectId

  constructor(subjectId: CredentialSubjectId) {
    super("reauthentication required before credential envelope access")
    this.subjectId = subjectId
  }
}

export class PostgresCredentialRepository {
  private readonly executor: PostgresExecutor

  constructor(executor: PostgresExecutor) {
    this.executor = executor
  }

  async saveSubject(subject: CredentialSubjectRecord): Promise<void> {
    const parsed = parseSubject(subject)
    await this.executor.query({
      name: "oauth.credential_subject.insert",
      text: `INSERT INTO credential_subjects (
        organization_id, credential_subject_id, partner_application_id, revision,
        key_version, envelope_algorithm, envelope_ciphertext, expires_at, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      params: [parsed.organizationId, parsed.credentialSubjectId, parsed.partnerApplicationId,
        parsed.revision, parsed.envelope.keyVersion, parsed.envelope.algorithm,
        parsed.envelope.ciphertext, parsed.expiresAt, parsed.status],
    })
  }

  async bindShop(binding: ShopCredentialBindingRecord): Promise<void> {
    const parsed = parseBinding(binding)
    await this.executor.transaction(async (tx) => {
      const rows = await tx.query({
        name: "oauth.credential_subject.bind.lock",
        text: `SELECT cs.status AS credential_status,
          cs.partner_application_id AS credential_partner_application_id,
          sc.status AS shop_status,
          sc.partner_application_id::text AS shop_partner_application_id,
          sc.market AS shop_market
          FROM credential_subjects AS cs
          INNER JOIN shop_connections AS sc
            ON sc.organization_id = cs.organization_id AND sc.id = $3
          WHERE cs.organization_id = $1 AND cs.credential_subject_id = $2
          FOR UPDATE OF cs, sc`,
        params: [parsed.organizationId, parsed.credentialSubjectId, parsed.shopId],
      })
      const row = rows[0]
      if (row === undefined || requiredString(row, "credential_status") !== "active") {
        throw new OAuthCredentialReauthenticationRequiredError(parsed.credentialSubjectId)
      }
      if (requiredString(row, "shop_status") !== "active"
        || requiredString(row, "credential_partner_application_id") !== requiredString(row, "shop_partner_application_id")) {
        throw new OAuthCredentialReauthenticationRequiredError(parsed.credentialSubjectId)
      }
      await tx.query({
        name: "oauth.credential_subject.binding.insert",
        text: `INSERT INTO shop_credential_bindings
          (organization_id, shop_id, credential_subject_id, status)
          VALUES ($1, $2, $3, $4)`,
        params: [parsed.organizationId, parsed.shopId, parsed.credentialSubjectId, parsed.status],
      })
    })
  }

  async recordRefreshOutcome(request: CredentialRefreshRequest): Promise<CredentialRefreshDecision> {
    const parsed = parseRefresh(request)
    return this.executor.transaction(async (tx) => {
      const rows = await tx.query({
        name: "oauth.credential_subject.refresh.lock",
        text: `SELECT organization_id, credential_subject_id, partner_application_id, revision,
          key_version, envelope_algorithm, envelope_ciphertext, expires_at, status
          FROM credential_subjects
          WHERE organization_id = $1 AND credential_subject_id = $2 FOR UPDATE`,
        params: [parsed.organizationId, parsed.credentialSubjectId],
      })
      const row = rows[0]
      if (row === undefined) return { kind: "denied", reason: "credential_subject_not_found" }
      const subject = mapSubject(row)
      if (subject.revision !== parsed.expectedRevision) return { kind: "denied", reason: "stale_credential_revision" }
      return persistRefreshOutcome(tx, subject, parsed)
    })
  }

  async withRefreshLease(
    request: Pick<CredentialRefreshRequest, "organizationId" | "credentialSubjectId" | "expectedRevision" | "updatedAt">,
    execute: (subject: CredentialSubjectRecord) => Promise<CredentialRefreshLeaseResult>,
  ): Promise<CredentialRefreshDecision> {
    const parsed = parseRefresh({ ...request, outcome: "outcome_unknown" })
    return this.executor.transaction(async (tx) => {
      const rows = await tx.query({
        name: "oauth.credential_subject.refresh.lock",
        text: `SELECT organization_id, credential_subject_id, partner_application_id, revision,
          key_version, envelope_algorithm, envelope_ciphertext, expires_at, status
          FROM credential_subjects
          WHERE organization_id = $1 AND credential_subject_id = $2 FOR UPDATE`,
        params: [parsed.organizationId, parsed.credentialSubjectId],
      })
      const row = rows[0]
      if (row === undefined) return { kind: "denied", reason: "credential_subject_not_found" }
      const subject = mapSubject(row)
      if (subject.revision !== parsed.expectedRevision) return { kind: "denied", reason: "stale_credential_revision" }
      if (subject.status !== "active") return { kind: "reauth_required", reason: "refresh_outcome_unknown" }
      const result = await execute(subject)
      if (result.outcome === "denied") return { kind: "denied", reason: result.reason }
      return persistRefreshOutcome(tx, subject, {
        ...parsed,
        outcome: result.outcome,
        ...(result.outcome === "rotated" ? { envelope: result.envelope, expiresAt: result.expiresAt } : {}),
      })
    })
  }

  async readEnvelope(organizationId: OrganizationId, subjectId: CredentialSubjectId): Promise<EncryptedCredentialEnvelope> {
    const rows = await this.executor.query({
      name: "oauth.credential_subject.envelope.read",
      text: `SELECT organization_id, credential_subject_id, partner_application_id, revision,
        key_version, envelope_algorithm, envelope_ciphertext, expires_at, status
        FROM credential_subjects WHERE organization_id = $1 AND credential_subject_id = $2`,
      params: [organizationId, subjectId],
    })
    const row = rows[0]
    if (row === undefined) throw new OAuthCredentialReauthenticationRequiredError(subjectId)
    const subject = mapSubject(row)
    if (subject.status !== "active") throw new OAuthCredentialReauthenticationRequiredError(subjectId)
    return subject.envelope
  }
}

async function persistRefreshOutcome(
  tx: PostgresExecutor,
  subject: CredentialSubjectRecord,
  parsed: CredentialRefreshRequest,
): Promise<CredentialRefreshDecision> {
  if (parsed.outcome === "outcome_unknown") {
    await tx.query({
      name: "oauth.credential_subject.outcome_unknown",
      text: `UPDATE credential_subjects SET status = 'reauth_required', updated_at = $3
        WHERE organization_id = $1 AND credential_subject_id = $2 AND revision = $4`,
      params: [parsed.organizationId, parsed.credentialSubjectId, parsed.updatedAt, parsed.expectedRevision],
    })
    await tx.query({
      name: "oauth.credential_subject.bindings.reauth",
      text: `UPDATE shop_credential_bindings SET status = 'reauth_required'
        WHERE organization_id = $1 AND credential_subject_id = $2 AND status = 'active'`,
      params: [parsed.organizationId, parsed.credentialSubjectId],
    })
    return { kind: "reauth_required", reason: "refresh_outcome_unknown" }
  }
  const envelope = parsed.envelope
  if (envelope === undefined) throw new Error("rotated credential outcome requires encrypted envelope")
  const nextRevision = subject.revision + 1
  await tx.query({
    name: "oauth.credential_subject.rotate",
    text: `UPDATE credential_subjects SET revision = $3, key_version = $4,
      envelope_algorithm = $5, envelope_ciphertext = $6, status = 'active',
      updated_at = $7, expires_at = COALESCE($8, expires_at)
      WHERE organization_id = $1 AND credential_subject_id = $2 AND revision = $9`,
    params: [parsed.organizationId, parsed.credentialSubjectId, nextRevision, envelope.keyVersion,
      envelope.algorithm, envelope.ciphertext, parsed.updatedAt, parsed.expiresAt ?? null, parsed.expectedRevision],
  })
  return {
    kind: "rotated",
    subject: {
      ...subject,
      revision: nextRevision,
      status: "active",
      envelope,
      ...(parsed.expiresAt === undefined ? {} : { expiresAt: parsed.expiresAt }),
    },
  }
}

function parseSubject(subject: CredentialSubjectRecord): CredentialSubjectRecord {
  return {
    ...subject,
    organizationId: OrganizationIdSchema.parse(subject.organizationId),
    credentialSubjectId: CredentialSubjectIdSchema.parse(subject.credentialSubjectId),
    partnerApplicationId: PartnerApplicationIdSchema.parse(subject.partnerApplicationId),
    envelope: EncryptedCredentialEnvelopeSchema.parse(subject.envelope),
  }
}

function parseBinding(binding: ShopCredentialBindingRecord): ShopCredentialBindingRecord {
  return {
    ...binding,
    organizationId: OrganizationIdSchema.parse(binding.organizationId),
    shopId: ShopIdSchema.parse(binding.shopId),
    credentialSubjectId: CredentialSubjectIdSchema.parse(binding.credentialSubjectId),
  }
}

function parseRefresh(request: CredentialRefreshRequest): CredentialRefreshRequest {
  if (!Number.isInteger(request.expectedRevision) || request.expectedRevision < 1) throw new Error("invalid expected credential revision")
  if (request.outcome === "rotated") {
    return {
      ...request,
      envelope: EncryptedCredentialEnvelopeSchema.parse(request.envelope),
      ...(request.expiresAt === undefined ? {} : { expiresAt: z.string().datetime({ offset: true }).parse(request.expiresAt) }),
    }
  }
  return request
}

function mapSubject(row: SqlRow): CredentialSubjectRecord {
  return parseSubject({
    organizationId: OrganizationIdSchema.parse(requiredString(row, "organization_id")),
    credentialSubjectId: CredentialSubjectIdSchema.parse(requiredString(row, "credential_subject_id")),
    partnerApplicationId: PartnerApplicationIdSchema.parse(requiredString(row, "partner_application_id")),
    revision: requiredNumber(row, "revision"),
    status: requiredString(row, "status") as CredentialSubjectRecord["status"],
    expiresAt: requiredString(row, "expires_at"),
    envelope: {
      keyVersion: requiredNumber(row, "key_version"),
      algorithm: requiredString(row, "envelope_algorithm") as "kms-envelope-v1",
      ciphertext: requiredString(row, "envelope_ciphertext"),
    },
  })
}

function requiredString(row: SqlRow, key: string): string {
  const value = row[key]
  if (typeof value !== "string") throw new Error(`Invalid credential row field: ${key}`)
  return value
}

function requiredNumber(row: SqlRow, key: string): number {
  const value = row[key]
  if (typeof value === "number" && Number.isSafeInteger(value)) return value
  // PostgreSQL bigint columns (e.g. `revision`) arrive as decimal strings via `pg`.
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    const parsed = Number(value.trim())
    if (Number.isSafeInteger(parsed)) return parsed
  }
  throw new Error(`Invalid credential row field: ${key}`)
}
