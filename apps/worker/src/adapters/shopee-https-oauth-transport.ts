import { request as httpsRequest } from "node:https"
import type { IncomingHttpHeaders } from "node:http"
import type { ShopeeTokenExchangeRequest } from "../../../../packages/integrations/src/shopee-oauth.ts"
import type { ShopeeOAuthExchangeTransport } from "./shopee-oauth-exchange-provider.ts"

const MAX_RESPONSE_BYTES = 65_536

export type ShopeeHttpsRequest = {
  readonly method: "POST"
  readonly url: string
  readonly headers: ShopeeTokenExchangeRequest["headers"]
  readonly body: string
  readonly timeoutMs: number
}

export type ShopeeHttpsResponse = {
  readonly statusCode: number
  readonly contentType?: string
  readonly body: string
}

export interface ShopeeHttpsRequestExecutor {
  execute(request: ShopeeHttpsRequest): Promise<ShopeeHttpsResponse>
}

export type WorkerShopeeHttpsOAuthTransportInput = {
  readonly baseUrl: string
  readonly requestTimeoutMs: number
  readonly executor?: ShopeeHttpsRequestExecutor
}

export class ShopeeOAuthTransportError extends Error {
  readonly name = "ShopeeOAuthTransportError"
  readonly reason: "invalid_base_url" | "request_origin_mismatch" | "response_not_json" | "response_malformed" | "response_too_large" | "network_failure"

  constructor(reason: ShopeeOAuthTransportError["reason"]) {
    super("Shopee OAuth HTTPS transport failed")
    this.reason = reason
  }
}

export function createWorkerShopeeHttpsOAuthTransport(
  input: WorkerShopeeHttpsOAuthTransportInput,
): ShopeeOAuthExchangeTransport {
  const baseUrl = parseBaseUrl(input.baseUrl)
  if (!Number.isInteger(input.requestTimeoutMs) || input.requestTimeoutMs < 1_000 || input.requestTimeoutMs > 30_000) {
    throw new ShopeeOAuthTransportError("invalid_base_url")
  }
  const executor = input.executor ?? createNodeShopeeHttpsRequestExecutor()
  return {
    send: async (request) => {
      if (!isSameOrigin(baseUrl, request.url)) throw new ShopeeOAuthTransportError("request_origin_mismatch")
      const response = await executor.execute({ ...request, timeoutMs: input.requestTimeoutMs })
      if (response.contentType?.toLowerCase().includes("application/json") !== true) {
        throw new ShopeeOAuthTransportError("response_not_json")
      }
      try {
        return JSON.parse(response.body) as unknown
      } catch {
        throw new ShopeeOAuthTransportError("response_malformed")
      }
    },
  }
}

export function createNodeShopeeHttpsRequestExecutor(): ShopeeHttpsRequestExecutor {
  return {
    execute: (input) => new Promise((resolve, reject) => {
      const request = httpsRequest(input.url, {
        method: input.method,
        headers: input.headers,
        timeout: input.timeoutMs,
      }, (response) => {
        const chunks: Buffer[] = []
        let size = 0
        response.on("data", (chunk: Buffer) => {
          size += chunk.length
          if (size > MAX_RESPONSE_BYTES) {
            request.destroy()
            reject(new ShopeeOAuthTransportError("response_too_large"))
            return
          }
          chunks.push(chunk)
        })
        response.on("end", () => {
          const responseContentType = contentType(response.headers)
          resolve({
            statusCode: response.statusCode ?? 0,
            ...(responseContentType === undefined ? {} : { contentType: responseContentType }),
            body: Buffer.concat(chunks).toString("utf8"),
          })
        })
        response.on("error", () => reject(new ShopeeOAuthTransportError("network_failure")))
      })
      request.on("timeout", () => request.destroy(new ShopeeOAuthTransportError("network_failure")))
      request.on("error", () => reject(new ShopeeOAuthTransportError("network_failure")))
      request.end(input.body)
    }),
  }
}

function parseBaseUrl(value: string): URL {
  try {
    return new URL(value)
  } catch {
    throw new ShopeeOAuthTransportError("invalid_base_url")
  }
}

function isSameOrigin(baseUrl: URL, requestUrl: string): boolean {
  try {
    return new URL(requestUrl).origin === baseUrl.origin
  } catch {
    return false
  }
}

function contentType(headers: IncomingHttpHeaders): string | undefined {
  const value = headers["content-type"]
  return typeof value === "string" ? value : undefined
}
