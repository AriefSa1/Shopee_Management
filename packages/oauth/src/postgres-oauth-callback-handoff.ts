import type {
  PostgresExecutor,
  SqlRow,
  SqlStatement,
} from "../../delivery/src/postgres-delivery.ts"
import type { KmsEnvelopeCodec } from "./durable-contracts.ts"
import { KmsEncryptionContextSchema, KmsMarketSchema } from "./durable-contracts.ts"
import {
  type OAuthCallbackInput,
  OAuthCallbackInputSchema,
  type OAuthStateRecord,
  OAuthStateRecordSchema,
} from "./model.ts"
import {
  createOAuthExchangeCommand,
  type OAuthExchangeProjection,
} from "./oauth-callback-handoff.ts"
import { isOAuthStateExpired } from "./state.ts"

export type OAuthCallbackHandoffResult =
  | {
      readonly kind: "accepted"
      readonly attemptId: string
      readonly commandId: string
      readonly eventId: string
    }
  | {
      readonly kind: "duplicate"
      readonly attemptId: string
      readonly commandId: string
      readonly eventId: string
    }
  | {
      readonly kind: "denied"
      readonly reason:
        | "state_not_found"
        | "state_expired"
        | "state_already_claimed"
        | "state_actor_mismatch"
    }

export type OAuthCallbackHandoffOptions = {
  readonly keyVersion: number
  readonly nextIds: () => { readonly commandId: string; readonly eventId: string }
}

export class PostgresOAuthCallbackHandoff {
  private readonly executor: PostgresExecutor
  private readonly kms: KmsEnvelopeCodec
  private readonly options: OAuthCallbackHandoffOptions

  constructor(
    executor: PostgresExecutor,
    kms: KmsEnvelopeCodec,
    options: OAuthCallbackHandoffOptions,
  ) {
    this.executor = executor
    this.kms = kms
    this.options = options
  }

  async accept(input: OAuthCallbackInput): Promise<OAuthCallbackHandoffResult> {
    const callback = OAuthCallbackInputSchema.parse(input)
    return this.executor.transaction(async (tx) => {
      const rows = await tx.query(stateLock(callback))
      const row = rows[0]
      if (row === undefined) return { kind: "denied", reason: "state_not_found" }
      const state = mapState(row)
      if (isOAuthStateExpired(state.expiresAt, callback.receivedAt) || state.status === "expired") {
        if (state.status === "issued") await tx.query(stateStatus(callback, "expired"))
        return { kind: "denied", reason: "state_expired" }
      }
      if (
        state.actor.issuer !== callback.actor.issuer ||
        state.actor.subject !== callback.actor.subject
      ) {
        return { kind: "denied", reason: "state_actor_mismatch" }
      }
      if (state.status === "claimed") return existingHandoff(tx, state)

      const context = KmsEncryptionContextSchema.parse({
        purpose: "oauth_callback_code",
        organizationId: state.organizationId,
        partnerApplicationId: state.partnerApplicationId,
        market: KmsMarketSchema.parse(state.market),
      })
      const envelope = await this.kms.seal(callback.code, this.options.keyVersion, context)
      const ids = this.options.nextIds()
      const projection = createOAuthExchangeCommand({
        callback,
        attemptId: state.attemptId,
        partnerApplicationId: state.partnerApplicationId,
        market: state.market,
        envelopeReference: state.attemptId,
        commandId: ids.commandId,
        eventId: ids.eventId,
      })
      await tx.query(commandInsert(projection))
      await tx.query(outboxInsert(projection))
      await tx.query(envelopeInsert(state, callback.shopId, envelope, projection, callback.receivedAt))
      await tx.query(stateStatus(callback, "claimed"))
      return {
        kind: "accepted",
        attemptId: state.attemptId,
        commandId: ids.commandId,
        eventId: ids.eventId,
      }
    })
  }
}

function stateLock(callback: OAuthCallbackInput): SqlStatement {
  return {
    name: "oauth.exchange.state.lock",
    text: `SELECT organization_id, state_hash, attempt_id, actor_issuer, actor_subject,
      partner_application_id, market, issued_at, expires_at, status
      FROM oauth_states WHERE organization_id = $1 AND state_hash = $2 FOR UPDATE`,
    params: [callback.organizationId, callback.stateHash],
  }
}

function stateStatus(callback: OAuthCallbackInput, status: "claimed" | "expired"): SqlStatement {
  return {
    name: "oauth.exchange.state.claim",
    text: `UPDATE oauth_states SET status = $3, claimed_at = $4
      WHERE organization_id = $1 AND state_hash = $2 AND status = 'issued'`,
    params: [callback.organizationId, callback.stateHash, status, callback.receivedAt],
  }
}

async function existingHandoff(
  tx: PostgresExecutor,
  state: OAuthStateRecord,
): Promise<OAuthCallbackHandoffResult> {
  const rows = await tx.query({
    name: "oauth.exchange.command.read",
    text: `SELECT command_id, event_id FROM oauth_exchange_commands
      WHERE organization_id = $1 AND attempt_id = $2`,
    params: [state.organizationId, state.attemptId],
  })
  const row = rows[0]
  if (row === undefined) return { kind: "denied", reason: "state_already_claimed" }
  const commandId = requiredString(row, "command_id")
  const eventId = requiredString(row, "event_id")
  return { kind: "duplicate", attemptId: state.attemptId, commandId, eventId }
}

function envelopeInsert(
  state: OAuthStateRecord,
  shopId: string,
  envelope: {
    readonly keyVersion: number
    readonly algorithm: string
    readonly ciphertext: string
  },
  projection: OAuthExchangeProjection,
  createdAt: string,
): SqlStatement {
  return {
    name: "oauth.exchange.envelope.insert",
    text: `INSERT INTO oauth_exchange_commands (
      organization_id, attempt_id, state_hash, partner_application_id, market,
      shop_id, actor_issuer, actor_subject, command_id, event_id, envelope_algorithm,
      envelope_key_version, envelope_ciphertext, status, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'pending', $14)`,
    params: [
      state.organizationId,
      state.attemptId,
      state.stateHash,
      state.partnerApplicationId,
      state.market,
      shopId,
      state.actor.issuer,
      state.actor.subject,
      projection.command.commandId,
      projection.outbox.eventId,
      envelope.algorithm,
      envelope.keyVersion,
      envelope.ciphertext,
      createdAt,
    ],
  }
}

function commandInsert(projection: OAuthExchangeProjection): SqlStatement {
  return {
    name: "oauth.exchange.command.insert",
    text: `INSERT INTO delivery_commands (
      organization_id, command_id, command_type, schema_version, aggregate_type,
      aggregate_id, dedupe_key, payload, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`,
    params: [
      projection.command.organizationId,
      projection.command.commandId,
      projection.command.commandType,
      projection.command.schemaVersion,
      projection.command.aggregateType,
      projection.command.aggregateId,
      projection.command.dedupeKey,
      JSON.stringify(projection.command.payload),
      projection.command.createdAt,
    ],
  }
}

function outboxInsert(projection: OAuthExchangeProjection): SqlStatement {
  return {
    name: "oauth.exchange.outbox.insert",
    text: `INSERT INTO outbox_events (
      organization_id, event_id, event_type, schema_version, aggregate_type,
      aggregate_id, command_id, dedupe_key, available_at, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    params: [
      projection.outbox.organizationId,
      projection.outbox.eventId,
      projection.outbox.eventType,
      projection.outbox.schemaVersion,
      projection.outbox.aggregateType,
      projection.outbox.aggregateId,
      projection.outbox.commandId,
      projection.outbox.dedupeKey,
      projection.outbox.availableAt,
      projection.outbox.createdAt,
    ],
  }
}

function mapState(row: SqlRow): OAuthStateRecord {
  return OAuthStateRecordSchema.parse({
    organizationId: requiredString(row, "organization_id"),
    stateHash: requiredString(row, "state_hash"),
    attemptId: requiredString(row, "attempt_id"),
    actor: {
      issuer: requiredString(row, "actor_issuer"),
      subject: requiredString(row, "actor_subject"),
    },
    partnerApplicationId: requiredString(row, "partner_application_id"),
    market: requiredString(row, "market"),
    issuedAt: requiredString(row, "issued_at"),
    expiresAt: requiredString(row, "expires_at"),
    status: requiredString(row, "status"),
  })
}

function requiredString(row: SqlRow, key: string): string {
  const value = row[key]
  if (typeof value !== "string") throw new Error(`Invalid OAuth handoff row field: ${key}`)
  return value
}
