import type {
  PostgresExecutor,
  SqlRow,
  SqlStatement,
} from "../../delivery/src/postgres-delivery.ts"
import { type OrganizationId, OrganizationIdSchema } from "../../identity/src/model.ts"
import type { EncryptedCredentialEnvelope } from "./durable-contracts.ts"
import {
  type OAuthAttemptId,
  OAuthAttemptIdSchema,
  OAuthMarketSchema,
  OAuthStateHashSchema,
  PartnerApplicationIdSchema,
  ShopeeShopIdSchema,
} from "./model.ts"
import type { OAuthExchangeHandoff } from "./worker-handoff-exchange.ts"

export type OAuthExchangeLease = {
  readonly organizationId: OrganizationId
  readonly attemptId: OAuthAttemptId
  readonly workerId: string
  readonly leaseExpiresAt: string
  readonly handoff: OAuthExchangeHandoff
}

export type OAuthExchangeClaimInput = {
  readonly workerId: string
  readonly now: string
  readonly leaseSeconds: number
  readonly organizationId?: OrganizationId
}

export class OAuthExchangeLeaseError extends Error {
  readonly name = "OAuthExchangeLeaseError"
  readonly reason: "invalid_lease" | "stale_lease"

  constructor(reason: OAuthExchangeLeaseError["reason"]) {
    super("OAuth exchange lease operation failed")
    this.reason = reason
  }
}

export class PostgresOAuthExchangeQueue {
  private readonly executor: PostgresExecutor

  constructor(executor: PostgresExecutor) {
    this.executor = executor
  }

  async claimNext(input: OAuthExchangeClaimInput): Promise<OAuthExchangeLease | undefined> {
    if (!Number.isInteger(input.leaseSeconds) || input.leaseSeconds <= 0) {
      throw new OAuthExchangeLeaseError("invalid_lease")
    }
    const leaseExpiresAt = new Date(Date.parse(input.now) + input.leaseSeconds * 1000).toISOString()
    return this.executor.transaction(async (tx) => {
      const rows = await tx.query(selectPending(input))
      const row = rows[0]
      if (row === undefined) return undefined
      const attemptId = requiredAttemptId(row, "attempt_id")
      const organizationId = requiredOrganizationId(row, "organization_id")
      const updated = await tx.query({
        name: "oauth.exchange.lease.claim",
        text: `UPDATE oauth_exchange_commands
          SET status = 'processing', lease_owner = $3, lease_expires_at = $4, failure_reason = NULL
          WHERE organization_id = $1 AND attempt_id = $2
            AND (status = 'pending' OR (status = 'processing' AND lease_expires_at < $5))
          RETURNING attempt_id`,
        params: [organizationId, attemptId, input.workerId, leaseExpiresAt, input.now],
      })
      if (updated[0] === undefined) return undefined
      return mapLease(row, input.workerId, leaseExpiresAt)
    })
  }

  async complete(
    input: Pick<OAuthExchangeLease, "organizationId" | "attemptId" | "workerId">,
  ): Promise<void> {
    const updated = await this.executor.query(updateLease(input, "completed"))
    if (updated[0] === undefined) throw new OAuthExchangeLeaseError("stale_lease")
  }

  async fail(
    input: Pick<OAuthExchangeLease, "organizationId" | "attemptId" | "workerId">,
    reason: "kms_failed" | "provider_failed" | "persistence_failed" | "unknown_failure",
  ): Promise<void> {
    const updated = await this.executor.query({
      ...updateLease(input, "failed"),
      name: "oauth.exchange.lease.fail",
      text: updateLease(input, "failed").text.replace(
        "SET status = 'failed'",
        "SET status = 'failed', failure_reason = $4",
      ),
      params: [...updateLease(input, "failed").params, reason],
    })
    if (updated[0] === undefined) throw new OAuthExchangeLeaseError("stale_lease")
  }
}

function selectPending(input: OAuthExchangeClaimInput): SqlStatement {
  return {
    name: "oauth.exchange.lease.select",
    text: `SELECT q.organization_id, q.attempt_id, q.state_hash, q.partner_application_id, q.market,
      q.shop_id,
      s.issued_at, s.expires_at,
      q.actor_issuer, q.actor_subject, q.envelope_algorithm, q.envelope_key_version,
      q.envelope_ciphertext
      FROM oauth_exchange_commands AS q
      INNER JOIN oauth_states AS s
        ON s.organization_id = q.organization_id AND s.state_hash = q.state_hash
      WHERE ($1::uuid IS NULL OR q.organization_id = $1)
        AND (q.status = 'pending' OR (q.status = 'processing' AND q.lease_expires_at < $2))
      ORDER BY q.created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1`,
    params: [input.organizationId ?? null, input.now],
  }
}

function updateLease(
  input: Pick<OAuthExchangeLease, "organizationId" | "attemptId" | "workerId">,
  status: "completed" | "failed",
): SqlStatement {
  return {
    name: "oauth.exchange.lease.complete",
    text: `UPDATE oauth_exchange_commands
      SET status = '${status}', lease_owner = NULL, lease_expires_at = NULL
      WHERE organization_id = $1 AND attempt_id = $2
        AND status = 'processing' AND lease_owner = $3
      RETURNING attempt_id`,
    params: [input.organizationId, input.attemptId, input.workerId],
  }
}

function mapLease(row: SqlRow, workerId: string, leaseExpiresAt: string): OAuthExchangeLease {
  const organizationId = requiredOrganizationId(row, "organization_id")
  const attemptId = requiredAttemptId(row, "attempt_id")
  const market = OAuthMarketSchema.parse(requiredString(row, "market"))
  const algorithm = requiredString(row, "envelope_algorithm")
  if (algorithm !== "kms-envelope-v1") throw new OAuthExchangeLeaseError("invalid_lease")
  const envelope: EncryptedCredentialEnvelope = {
    algorithm,
    keyVersion: requiredNumber(row, "envelope_key_version"),
    ciphertext: requiredString(row, "envelope_ciphertext"),
  }
  return {
    organizationId,
    attemptId,
    workerId,
    leaseExpiresAt,
    handoff: {
      claim: {
        attemptId,
        organizationId,
        actor: {
          issuer: requiredString(row, "actor_issuer"),
          subject: requiredString(row, "actor_subject"),
        },
        partnerApplicationId: PartnerApplicationIdSchema.parse(
          requiredString(row, "partner_application_id"),
        ),
        market,
        shopId: ShopeeShopIdSchema.parse(requiredString(row, "shop_id")),
        stateHash: OAuthStateHashSchema.parse(requiredString(row, "state_hash")),
        issuedAt: requiredString(row, "issued_at"),
        expiresAt: requiredString(row, "expires_at"),
      },
      envelope,
    },
  }
}

function requiredOrganizationId(row: SqlRow, key: string): OrganizationId {
  return OrganizationIdSchema.parse(requiredString(row, key))
}

function requiredAttemptId(row: SqlRow, key: string): OAuthAttemptId {
  return OAuthAttemptIdSchema.parse(requiredString(row, key))
}

function requiredNumber(row: SqlRow, key: string): number {
  const value = row[key]
  if (typeof value !== "number") throw new OAuthExchangeLeaseError("invalid_lease")
  return value
}

function requiredString(row: SqlRow, key: string): string {
  const value = row[key]
  if (typeof value !== "string") throw new OAuthExchangeLeaseError("invalid_lease")
  return value
}
