import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { OrganizationIdSchema, ShopIdSchema } from "../../../../packages/identity/src/model.ts"
import {
  OAuthAttemptIdSchema,
  OAuthStateHashSchema,
  PartnerApplicationIdSchema,
  CallbackCodeSchema,
  ShopeeShopIdSchema,
  WorkerExchangeEvidenceSchema,
} from "../../../../packages/oauth/src/model.ts"
import {
  createWorkerShopeeOAuthExchangeProvider,
  ShopeeWorkerOAuthExchangeError,
} from "./shopee-oauth-exchange-provider.ts"

const claim = {
  attemptId: OAuthAttemptIdSchema.parse("20000000-0000-4000-8000-000000000001"),
  organizationId: OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001"),
  actor: { issuer: "https://id.example.test", subject: "owner-a" },
  partnerApplicationId: PartnerApplicationIdSchema.parse("partner-worker-adapter"),
  market: "ID" as const,
  stateHash: OAuthStateHashSchema.parse("state-worker-adapter-000000000000000000000001"),
  issuedAt: "2026-09-12T00:00:00.000Z",
  expiresAt: "2026-09-12T00:10:00.000Z",
  shopId: ShopeeShopIdSchema.parse("1819834906"),
  callbackCode: CallbackCodeSchema.parse("callback-code-fixture"),
}

describe("worker Shopee OAuth exchange provider adapter", () => {
  it("reads partner credentials only from the worker secret provider and commits a successful exchange", async () => {
    // Given: worker-only secrets, an exchange transport, and a token committer that produces verified evidence.
    const requestedSecrets: string[] = []
    const requests: { readonly body: string; readonly url: string }[] = []
    let committed = false
    const provider = createWorkerShopeeOAuthExchangeProvider({
      baseUrl: "https://partner.shopeemobile.com",
      now: () => 1_654_673_582_000,
      secrets: {
        async get(name) {
          requestedSecrets.push(name)
          return name === "SHOPEE_PARTNER_ID" ? "80001" : "partner-key-fixture"
        },
      },
      transport: {
        async send(request) {
          requests.push({ body: request.body, url: request.url })
          return {
            request_id: "request-fixture",
            error: "",
            access_token: "access-token-fixture",
            refresh_token: "refresh-token-fixture",
            expire_in: 14_400,
          }
        },
      },
      committer: {
        async commit(input) {
          committed = input.exchange.accessToken === "access-token-fixture"
            && input.exchange.refreshToken === "refresh-token-fixture"
          return WorkerExchangeEvidenceSchema.parse({
            grantId: "30000000-0000-4000-8000-000000000001",
            organizationId: input.claim.organizationId,
            partnerApplicationId: input.claim.partnerApplicationId,
            grantKind: "shop_account",
            grantedAt: "2026-09-12T00:01:00.000Z",
            subjects: [{
              credentialSubjectId: "40000000-0000-4000-8000-000000000001",
              revision: 1,
              keyVersion: 1,
              shopIds: [ShopIdSchema.parse("50000000-0000-4000-8000-000000000001")],
            }],
            authorizedShopId: input.claim.shopId,
          })
        },
      },
    })

    // When: the worker adapter exchanges its callback claim.
    const evidence = await provider.exchange(claim)

    // Then: the signed request excludes the partner key and only verified evidence exits the adapter.
    assert.deepEqual(requestedSecrets, ["SHOPEE_PARTNER_ID", "SHOPEE_PARTNER_KEY"])
    assert.equal(requests.length, 1)
    assert.equal(requests[0]?.body.includes("partner-key-fixture"), false)
    assert.equal(requests[0]?.url.includes("partner-key-fixture"), false)
    assert.equal(committed, true)
    assert.equal(evidence.authorizedShopId, claim.shopId)
    assert.equal("accessToken" in evidence, false)
    assert.equal("refreshToken" in evidence, false)
  })

  it("does not commit provider rejections", async () => {
    // Given: a provider response with a safe rejection code.
    let commitCalls = 0
    const provider = createWorkerShopeeOAuthExchangeProvider({
      baseUrl: "https://partner.shopeemobile.com",
      now: () => 1_654_673_582_000,
      secrets: { async get(name) { return name === "SHOPEE_PARTNER_ID" ? "80001" : "partner-key-fixture" } },
      transport: { async send() { return { request_id: "request-rejected", error: "invalid_code" } } },
      committer: {
        async commit() {
          commitCalls += 1
          throw new Error("must not commit")
        },
      },
    })

    // When: the worker receives a rejected upstream exchange result.
    const result = provider.exchange(claim)

    // Then: no token persistence is attempted and only a safe provider error is returned.
    await assert.rejects(result, {
      name: ShopeeWorkerOAuthExchangeError.name,
      reason: "provider_rejected",
    })
    assert.equal(commitCalls, 0)
  })
})
