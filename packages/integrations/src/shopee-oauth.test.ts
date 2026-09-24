import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  buildShopeeTokenExchangeRequest,
  parseShopeeTokenExchangeResponse,
} from "./shopee-oauth.ts"

describe("Shopee OAuth token exchange contract", () => {
  it("builds the signed token exchange request without exposing the partner key", () => {
    // Given: a callback code and stable signing inputs.
    const request = buildShopeeTokenExchangeRequest({
      baseUrl: "https://partner.shopeemobile.com",
      partnerId: "80001",
      partnerKey: "partner-key-fixture",
      shopId: "1819834906",
      code: "callback-code-fixture",
      timestamp: 1_654_673_582,
    })

    // Then: the request uses the documented path, signature, and JSON body without the key.
    assert.equal(
      request.url,
      "https://partner.shopeemobile.com/api/v2/auth/token/get?partner_id=80001&timestamp=1654673582&sign=bc1ee04b293ce678b47a3880142bdb5106e162c278aba4305d556cad3ed082f8",
    )
    assert.deepEqual(request.headers, { "content-type": "application/json" })
    assert.equal(
      request.body,
      JSON.stringify({ code: "callback-code-fixture", partner_id: 80001, shop_id: 1819834906 }),
    )
    assert.equal(request.body.includes("partner-key-fixture"), false)
  })

  it("parses a successful token response into typed worker-only material", () => {
    // Given: the provider's successful response shape.
    const result = parseShopeeTokenExchangeResponse({
      request_id: "request-fixture",
      error: "",
      access_token: "access-token-fixture",
      refresh_token: "refresh-token-fixture",
      expire_in: 14_400,
    })

    // Then: tokens are available only in the typed exchange result.
    assert.deepEqual(result, {
      kind: "succeeded",
      requestId: "request-fixture",
      accessToken: "access-token-fixture",
      refreshToken: "refresh-token-fixture",
      expiresIn: 14_400,
    })
  })

  it("returns a safe rejection projection for a provider error", () => {
    // Given: a provider error containing a safe error code and request id.
    const result = parseShopeeTokenExchangeResponse({
      request_id: "request-rejected",
      error: "invalid_access_token",
      message: "provider detail must not be propagated",
    })

    // Then: only the safe error code and request id are returned.
    assert.deepEqual(result, {
      kind: "rejected",
      requestId: "request-rejected",
      code: "invalid_access_token",
    })
    assert.equal("message" in result, false)
  })
})
