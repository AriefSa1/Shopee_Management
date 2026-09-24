import {
  AuthorizationGrantFixtureSchema,
  AuthorizationGrantIdSchema,
  type AuthorizationGrantFixture,
  type AuthorizationGrantId,
} from "./model.ts"
import { OrganizationIdSchema, type OrganizationId } from "../../identity/src/model.ts"
import type { PostgresExecutor, SqlRow } from "../../delivery/src/postgres-delivery.ts"

export class OAuthGrantPersistenceError extends Error {
  readonly name = "OAuthGrantPersistenceError"
  readonly code: "invalid_row" | "organization_mismatch"

  constructor(code: OAuthGrantPersistenceError["code"]) {
    super(`OAuth grant persistence rejected the request: ${code}`)
    this.code = code
  }
}

export class PostgresOAuthGrantRepository {
  private readonly executor: PostgresExecutor

  constructor(executor: PostgresExecutor) {
    this.executor = executor
  }

  saveGrant(grant: AuthorizationGrantFixture): Promise<void> {
    return this.executor.transaction(async (tx) => {
      const parsed = AuthorizationGrantFixtureSchema.parse(grant)
      await tx.query({
        name: "oauth.grant.insert",
        text: `INSERT INTO oauth_grants (
          organization_id, grant_id, partner_application_id, grant_kind, granted_at
        ) VALUES ($1, $2, $3, $4, $5)`,
        params: [parsed.organizationId, parsed.grantId, parsed.partnerApplicationId, parsed.grantKind, parsed.grantedAt],
      })
      for (const subject of parsed.subjects) {
        await tx.query({
          name: "oauth.grant.subject.insert",
          text: `INSERT INTO oauth_grant_subjects (
            organization_id, grant_id, credential_subject_id, revision, key_version
          ) VALUES ($1, $2, $3, $4, $5)`,
          params: [parsed.organizationId, parsed.grantId, subject.credentialSubjectId, subject.revision, subject.keyVersion],
        })
        for (const shopId of subject.shopIds) {
          await tx.query({
            name: "oauth.grant.subject.shop.insert",
            text: `INSERT INTO oauth_grant_subject_shops (
              organization_id, grant_id, credential_subject_id, shop_id
            ) VALUES ($1, $2, $3, $4)`,
            params: [parsed.organizationId, parsed.grantId, subject.credentialSubjectId, shopId],
          })
        }
      }
    })
  }

  async getGrant(organizationId: OrganizationId, grantId: AuthorizationGrantId): Promise<AuthorizationGrantFixture | undefined> {
    const parsedOrganizationId = OrganizationIdSchema.parse(organizationId)
    const parsedGrantId = AuthorizationGrantIdSchema.parse(grantId)
    const rows = await this.executor.query({
      name: "oauth.grant.read",
      text: `SELECT g.organization_id, g.grant_id, g.partner_application_id, g.grant_kind, g.granted_at,
        s.credential_subject_id, s.revision, s.key_version, b.shop_id
      FROM oauth_grants AS g
      INNER JOIN oauth_grant_subjects AS s
        ON s.organization_id = g.organization_id AND s.grant_id = g.grant_id
      LEFT JOIN oauth_grant_subject_shops AS b
        ON b.organization_id = s.organization_id AND b.grant_id = s.grant_id
        AND b.credential_subject_id = s.credential_subject_id
      WHERE g.organization_id = $1 AND g.grant_id = $2
      ORDER BY s.credential_subject_id, b.shop_id`,
      params: [parsedOrganizationId, parsedGrantId],
    })
    if (rows.length === 0) return undefined
    return mapGrant(rows)
  }
}

function mapGrant(rows: readonly SqlRow[]): AuthorizationGrantFixture {
  const first = rows[0]
  if (first === undefined) throw new OAuthGrantPersistenceError("invalid_row")
  const organizationId = OrganizationIdSchema.parse(requiredString(first, "organization_id"))
  const grantId = AuthorizationGrantIdSchema.parse(requiredString(first, "grant_id"))
  const subjects = new Map<string, { readonly credentialSubjectId: string; readonly revision: number; readonly keyVersion: number; readonly shopIds: string[] }>()
  for (const row of rows) {
    if (requiredString(row, "organization_id") !== organizationId || requiredString(row, "grant_id") !== grantId) {
      throw new OAuthGrantPersistenceError("organization_mismatch")
    }
    const credentialSubjectId = requiredString(row, "credential_subject_id")
    const subject = subjects.get(credentialSubjectId) ?? {
      credentialSubjectId,
      revision: requiredNumber(row, "revision"),
      keyVersion: requiredNumber(row, "key_version"),
      shopIds: [],
    }
    const shopId = row["shop_id"]
    if (typeof shopId === "string") subject.shopIds.push(shopId)
    subjects.set(credentialSubjectId, subject)
  }
  return AuthorizationGrantFixtureSchema.parse({
    organizationId,
    grantId,
    partnerApplicationId: requiredString(first, "partner_application_id"),
    grantKind: requiredString(first, "grant_kind"),
    grantedAt: requiredString(first, "granted_at"),
    subjects: [...subjects.values()],
  })
}

function requiredString(row: SqlRow, key: string): string {
  const value = row[key]
  if (typeof value !== "string") throw new OAuthGrantPersistenceError("invalid_row")
  return value
}

function requiredNumber(row: SqlRow, key: string): number {
  const value = row[key]
  if (typeof value !== "number") throw new OAuthGrantPersistenceError("invalid_row")
  return value
}
