import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  parseWorkerShopeeLiveOAuthConfig,
  ShopeeLiveOAuthConfigError,
} from "./shopee-live-oauth-config.ts"

describe("worker Shopee live OAuth configuration", () => {
  it("accepts the explicit official API origin and a bounded request timeout", () => {
    // Given: a worker environment configured with the approved Shopee live origin.
    const environment = {
      SHOPEE_API_BASE_URL: "https://partner.shopeemobile.com",
      SHOPEE_OAUTH_TIMEOUT_MS: "12000",
    }

    // When: the worker parses its live OAuth configuration.
    const config = parseWorkerShopeeLiveOAuthConfig(environment)

    // Then: the normalized HTTPS origin and bounded timeout are available to the worker only.
    assert.deepEqual(config, {
      baseUrl: "https://partner.shopeemobile.com/",
      requestTimeoutMs: 12000,
    })
  })

  it("rejects a non-Shopee origin before a token request can be constructed", () => {
    // Given: an environment that points OAuth traffic to an unapproved origin.
    const environment = { SHOPEE_API_BASE_URL: "https://example.test" }

    // When: the worker parses the configured OAuth origin.
    const result = () => parseWorkerShopeeLiveOAuthConfig(environment)

    // Then: configuration fails closed without exposing the provided value.
    assert.throws(result, ShopeeLiveOAuthConfigError)
  })
})
