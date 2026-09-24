import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  buildShopeeSellerAuthorizationUrl,
  ShopeeAuthorizationUrlError,
} from "./shopee-authorization-url.ts"

describe("Shopee seller authorization URL", () => {
  it("builds the documented global production authorization URL", () => {
    // Given: a live Indonesian seller callback and an opaque CSRF state.
    const input = {
      partnerId: "2043951",
      redirectUri: "https://app.example.test/api/auth/shopee/callback",
      state: "opaque-state-value",
    }

    // When: the web boundary prepares the seller authorization redirect.
    const url = new URL(buildShopeeSellerAuthorizationUrl(input))

    // Then: the URL contains only Shopee's documented seller authorization parameters.
    assert.equal(url.origin, "https://open.shopee.com")
    assert.equal(url.pathname, "/auth")
    assert.deepEqual(Object.fromEntries(url.searchParams), {
      partner_id: "2043951",
      auth_type: "seller",
      redirect_uri: "https://app.example.test/api/auth/shopee/callback",
      response_type: "code",
      state: "opaque-state-value",
    })
  })

  it("rejects a redirect URI that cannot be a live callback", () => {
    // Given: a non-HTTPS redirect URI.
    const input = {
      partnerId: "2043951",
      redirectUri: "http://127.0.0.1:3000/api/auth/shopee/callback",
      state: "opaque-state-value",
    }

    // When: a production authorization URL is requested.
    const action = () => buildShopeeSellerAuthorizationUrl(input)

    // Then: construction fails before an untrusted URL is returned to a seller.
    assert.throws(action, ShopeeAuthorizationUrlError)
  })
})
