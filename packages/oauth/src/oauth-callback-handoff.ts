import {
  type CommandEnvelope,
  CommandIdSchema,
  EventIdSchema,
  OrganizationIdSchema,
  parseCommandEnvelope,
} from "../../delivery/src/contracts.ts"
import type { OutboxEvent } from "../../delivery/src/delivery-types.ts"
import {
  type OAuthAttemptId,
  OAuthAttemptIdSchema,
  type OAuthCallbackInput,
  type OAuthMarket,
  OAuthMarketSchema,
  type PartnerApplicationId,
  PartnerApplicationIdSchema,
} from "./model.ts"

export type OAuthExchangeProjectionInput = {
  readonly callback: OAuthCallbackInput
  readonly attemptId: OAuthAttemptId
  readonly partnerApplicationId: PartnerApplicationId
  readonly market: OAuthMarket
  readonly envelopeReference: OAuthAttemptId
  readonly commandId: string
  readonly eventId: string
}

export type OAuthExchangeProjection = {
  readonly command: CommandEnvelope
  readonly outbox: OutboxEvent
}

export function createOAuthExchangeCommand(
  input: OAuthExchangeProjectionInput,
): OAuthExchangeProjection {
  const organizationId = OrganizationIdSchema.parse(input.callback.organizationId)
  const attemptId = OAuthAttemptIdSchema.parse(input.attemptId)
  const partnerApplicationId = PartnerApplicationIdSchema.parse(input.partnerApplicationId)
  const market = OAuthMarketSchema.parse(input.market)
  const commandId = CommandIdSchema.parse(input.commandId)
  const eventId = EventIdSchema.parse(input.eventId)
  const dedupeKey = `oauth-exchange:${organizationId}:${attemptId}`
  const command = parseCommandEnvelope({
    organizationId,
    commandId,
    commandType: "shopee.oauth.exchange",
    schemaVersion: 1,
    aggregateType: "oauth-attempt",
    aggregateId: attemptId,
    dedupeKey,
    createdAt: input.callback.receivedAt,
    payload: {
      attemptId,
      organizationId,
      partnerApplicationId,
      market,
      shopId: input.callback.shopId,
      envelopeReference: OAuthAttemptIdSchema.parse(input.envelopeReference),
    },
  })
  const outbox: OutboxEvent = {
    organizationId,
    eventId: EventIdSchema.parse(eventId),
    eventType: "shopee.oauth.exchange.requested",
    schemaVersion: 1,
    commandId,
    aggregateType: "oauth-attempt",
    aggregateId: attemptId,
    dedupeKey,
    availableAt: input.callback.receivedAt,
    createdAt: input.callback.receivedAt,
  }
  return { command, outbox }
}
