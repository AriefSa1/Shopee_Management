import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { CallbackCodeSchema, OAuthAttemptIdSchema, OAuthStateHashSchema, PartnerApplicationIdSchema, ShopeeShopIdSchema, type OAuthCallbackInput } from "./model.ts"
import { OrganizationIdSchema } from "../../identity/src/model.ts"
import { createOAuthExchangeCommand } from "./oauth-callback-handoff.ts"

const organizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
const attemptId = OAuthAttemptIdSchema.parse("20000000-0000-4000-8000-000000000001")
const stateHash = OAuthStateHashSchema.parse("state-handoff-000000000000000000000000000001")
const partnerApplicationId = PartnerApplicationIdSchema.parse("partner-live")

describe("OAuth callback durable handoff", () => {
  it("creates a secret-free exchange command and outbox projection", () => {
    // Given: an accepted callback with an encrypted envelope reference.
    const callback: OAuthCallbackInput = {
      stateHash,
      organizationId,
      actor: { issuer: "https://issuer.example", subject: "owner-1" },
      receivedAt: "2026-09-10T00:00:00.000Z",
    code: CallbackCodeSchema.parse("raw-callback-code"),
    shopId: ShopeeShopIdSchema.parse("1819834906"),
    }

    // When: the durable handoff projection is created.
    const handoff = createOAuthExchangeCommand({
      callback,
      attemptId,
      partnerApplicationId,
      market: "ID",
      envelopeReference: attemptId,
      commandId: "40000000-0000-4000-8000-000000000001",
      eventId: "50000000-0000-4000-8000-000000000001",
    })

    // Then: identifiers are present but callback code and ciphertext are absent.
    assert.equal(handoff.command.payload["envelopeReference"], attemptId)
    assert.equal(handoff.command.payload["shopId"], "1819834906")
    assert.equal(JSON.stringify(handoff.command).includes("raw-callback-code"), false)
    assert.equal(JSON.stringify(handoff.outbox).includes("raw-callback-code"), false)
    assert.equal(handoff.command.dedupeKey, `oauth-exchange:${organizationId}:${attemptId}`)
  })
})
