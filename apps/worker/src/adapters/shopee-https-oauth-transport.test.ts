import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { ShopeeTokenExchangeRequest } from "../../../../packages/integrations/src/shopee-oauth.ts"
import {
  createWorkerShopeeHttpsOAuthTransport,
  ShopeeOAuthTransportError,
  type ShopeeHttpsRequestExecutor,
} from "./shopee-https-oauth-transport.ts"

const request: ShopeeTokenExchangeRequest = {
  method: "POST",
  url: "https://partner.shopeemobile.com/api/v2/auth/token/get?partner_id=1&timestamp=2&sign=fixture",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ code: "callback-code-fixture", partner_id: 1, shop_id: 1819834906 }),
}

describe("worker Shopee HTTPS OAuth transport", () => {
  it("sends the signed request only to the configured Shopee origin and parses JSON", async () => {
    // Given: a worker-only HTTPS executor that records the outbound request.
    const calls: unknown[] = []
    const executor: ShopeeHttpsRequestExecutor = {
      async execute(input) {
        calls.push(input)
        return { statusCode: 200, contentType: "application/json", body: '{"error":"invalid_code"}' }
      },
    }
    const transport = createWorkerShopeeHttpsOAuthTransport({
      baseUrl: "https://partner.shopeemobile.com/",
      requestTimeoutMs: 12_000,
      executor,
    })

    // When: the exchange adapter submits its signed token request.
    const response = await transport.send(request)

    // Then: the JSON provider response is returned and the request cannot drift to another origin.
    assert.deepEqual(response, { error: "invalid_code" })
    assert.deepEqual(calls, [{
      method: "POST",
      url: request.url,
      headers: request.headers,
      body: request.body,
      timeoutMs: 12_000,
    }])
  })

  it("rejects a signed request whose URL is outside the configured origin", async () => {
    // Given: a transport bounded to Shopee and a request with a foreign URL.
    const executor: ShopeeHttpsRequestExecutor = { async execute() { throw new Error("must not run") } }
    const transport = createWorkerShopeeHttpsOAuthTransport({
      baseUrl: "https://partner.shopeemobile.com/",
      requestTimeoutMs: 12_000,
      executor,
    })
    const foreignRequest = { ...request, url: "https://example.test/api/v2/auth/token/get" }

    // When: the worker attempts to dispatch the foreign request.
    const result = transport.send(foreignRequest)

    // Then: the executor is never reached and the request is rejected safely.
    await assert.rejects(result, ShopeeOAuthTransportError)
  })
})
