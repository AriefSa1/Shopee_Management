import {
  OAuthCallbackInputSchema,
  OAuthStateRecordSchema,
  type OAuthCallbackClaim,
  type OAuthCallbackInput,
  type OAuthStateHash,
  type OAuthStateRecord,
} from "./model.ts"
import { isOAuthStateExpired, type OAuthStateClaimDecision } from "./state.ts"
import type { OrganizationId } from "../../identity/src/model.ts"
import type { PostgresExecutor, SqlRow } from "../../delivery/src/postgres-delivery.ts"

type OAuthStateScope = {
  readonly organizationId: OrganizationId
  readonly stateHash: OAuthStateHash
}

export class PostgresOAuthStateRepository {
  private readonly executor: PostgresExecutor

  constructor(executor: PostgresExecutor) {
    this.executor = executor
  }

  async save(record: OAuthStateRecord): Promise<void> {
    const parsed = OAuthStateRecordSchema.parse(record)
    await this.executor.query({
      name: "oauth.state.insert",
      text: `INSERT INTO oauth_states (
        organization_id, state_hash, attempt_id, actor_issuer, actor_subject,
        partner_application_id, market, issued_at, expires_at, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      params: [
        parsed.organizationId,
        parsed.stateHash,
        parsed.attemptId,
        parsed.actor.issuer,
        parsed.actor.subject,
        parsed.partnerApplicationId,
        parsed.market,
        parsed.issuedAt,
        parsed.expiresAt,
        parsed.status,
      ],
    })
  }

  async get(organizationId: OrganizationId, stateHash: OAuthStateHash): Promise<OAuthStateRecord | undefined> {
    const rows = await this.executor.query(selectStatement("oauth.state.get", { organizationId, stateHash }))
    const row = rows[0]
    return row === undefined ? undefined : mapState(row)
  }

  async claim(input: OAuthCallbackInput): Promise<OAuthStateClaimDecision> {
    const callback = OAuthCallbackInputSchema.parse(input)
    return this.executor.transaction(async (tx) => {
      const rows = await tx.query(selectStatement("oauth.state.claim.lock", callback))
      const row = rows[0]
      if (row === undefined) return { kind: "denied", reason: "state_not_found" }
      const state = mapState(row)
      if (isOAuthStateExpired(state.expiresAt, callback.receivedAt)) {
        await tx.query(updateStatusStatement(callback, "expired", callback.receivedAt))
        return { kind: "denied", reason: "state_expired" }
      }
      if (state.status === "claimed") return { kind: "denied", reason: "state_already_claimed" }
      if (state.status === "expired") return { kind: "denied", reason: "state_expired" }
      if (state.actor.issuer !== callback.actor.issuer || state.actor.subject !== callback.actor.subject) {
        return { kind: "denied", reason: "state_actor_mismatch" }
      }
      await tx.query(updateStatusStatement(callback, "claimed", callback.receivedAt))
      return { kind: "claimed", claim: claimProjection(state, callback) }
    })
  }
}

function selectStatement(name: string, scope: OAuthStateScope): { readonly name: string; readonly text: string; readonly params: readonly string[] } {
  return {
    name,
      text: `SELECT organization_id, state_hash, attempt_id, actor_issuer, actor_subject,
      partner_application_id, market, issued_at, expires_at, status
      FROM oauth_states WHERE organization_id = $1 AND state_hash = $2${name === "oauth.state.claim.lock" ? " FOR UPDATE" : ""}`,
    params: [scope.organizationId, scope.stateHash],
  }
}

function updateStatusStatement(input: OAuthCallbackInput, status: "claimed" | "expired", claimedAt: string) {
  return {
    name: "oauth.state.status.update",
    text: `UPDATE oauth_states SET status = $3, claimed_at = $4
      WHERE organization_id = $1 AND state_hash = $2 AND status = 'issued'`,
    params: [input.organizationId, input.stateHash, status, claimedAt] as const,
  }
}

function mapState(row: SqlRow): OAuthStateRecord {
  return OAuthStateRecordSchema.parse({
    organizationId: requiredString(row, "organization_id"),
    stateHash: requiredString(row, "state_hash"),
    attemptId: requiredString(row, "attempt_id"),
    actor: { issuer: requiredString(row, "actor_issuer"), subject: requiredString(row, "actor_subject") },
    partnerApplicationId: requiredString(row, "partner_application_id"),
    market: requiredString(row, "market"),
    issuedAt: requiredString(row, "issued_at"),
    expiresAt: requiredString(row, "expires_at"),
    status: requiredString(row, "status"),
  })
}

function claimProjection(state: OAuthStateRecord, callback: OAuthCallbackInput): OAuthCallbackClaim {
  return {
    attemptId: state.attemptId,
    organizationId: state.organizationId,
    actor: state.actor,
    partnerApplicationId: state.partnerApplicationId,
    market: state.market,
    stateHash: state.stateHash,
    issuedAt: state.issuedAt,
    expiresAt: state.expiresAt,
    shopId: callback.shopId,
    callbackCode: callback.code,
  }
}

function requiredString(row: SqlRow, key: string): string {
  const value = row[key]
  if (typeof value !== "string") throw new Error(`Invalid OAuth state row field: ${key}`)
  return value
}
