import { z } from "zod"
import {
  buildShopeeTokenExchangeRequest,
  parseShopeeTokenExchangeResponse,
  type ShopeeTokenExchangeRequest,
  type ShopeeTokenExchangeResult,
} from "../../../../packages/integrations/src/shopee-oauth.ts"
import type { ShopeeSecretProvider } from "../../../../packages/integrations/src/shopee-secrets.ts"
import type {
  OAuthCallbackClaim,
  OfficialOAuthTokenExchangeProvider,
  WorkerExchangeEvidence,
} from "../../../../packages/oauth/src/model.ts"

const ShopeePartnerIdSchema = z.string().regex(/^[1-9][0-9]*$/)
const ShopeePartnerKeySchema = z.string().trim().min(1)
const ShopeeBaseUrlSchema = z.string().url()

type SuccessfulShopeeTokenExchange = Extract<ShopeeTokenExchangeResult, { readonly kind: "succeeded" }>

export interface ShopeeOAuthExchangeTransport {
  send(request: ShopeeTokenExchangeRequest): Promise<unknown>
}

export interface OAuthExchangeCredentialCommitter {
  commit(input: {
    readonly claim: OAuthCallbackClaim
    readonly exchange: SuccessfulShopeeTokenExchange
  }): Promise<WorkerExchangeEvidence>
}

export type WorkerShopeeOAuthExchangeProviderInput = {
  readonly baseUrl: string
  readonly now: () => number
  readonly secrets: ShopeeSecretProvider
  readonly transport: ShopeeOAuthExchangeTransport
  readonly committer: OAuthExchangeCredentialCommitter
}

export class ShopeeWorkerOAuthExchangeError extends Error {
  readonly name = "ShopeeWorkerOAuthExchangeError"
  readonly reason:
    | "invalid_base_url"
    | "invalid_timestamp"
    | "missing_partner_id"
    | "invalid_partner_id"
    | "missing_partner_key"
    | "invalid_partner_key"
    | "provider_rejected"

  constructor(reason: ShopeeWorkerOAuthExchangeError["reason"]) {
    super("Shopee worker OAuth exchange could not be completed")
    this.reason = reason
  }
}

export function createWorkerShopeeOAuthExchangeProvider(
  input: WorkerShopeeOAuthExchangeProviderInput,
): OfficialOAuthTokenExchangeProvider {
  const baseUrl = parseBaseUrl(input.baseUrl)
  return {
    exchange: async (claim) => {
      const partnerId = await readPartnerId(input.secrets)
      const partnerKey = await readPartnerKey(input.secrets)
      const request = buildShopeeTokenExchangeRequest({
        baseUrl,
        partnerId,
        partnerKey,
        shopId: claim.shopId,
        code: claim.callbackCode,
        timestamp: toTimestamp(input.now()),
      })
      const response = parseShopeeTokenExchangeResponse(await input.transport.send(request))
      switch (response.kind) {
        case "succeeded":
          return input.committer.commit({ claim, exchange: response })
        case "rejected":
          throw new ShopeeWorkerOAuthExchangeError("provider_rejected")
        default:
          return assertNever(response)
      }
    },
  }
}

function parseBaseUrl(value: string): string {
  const parsed = ShopeeBaseUrlSchema.safeParse(value)
  if (!parsed.success) throw new ShopeeWorkerOAuthExchangeError("invalid_base_url")
  return parsed.data
}

function toTimestamp(value: number): number {
  const timestamp = Math.floor(value / 1_000)
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new ShopeeWorkerOAuthExchangeError("invalid_timestamp")
  }
  return timestamp
}

async function readPartnerId(secrets: ShopeeSecretProvider): Promise<string> {
  const value = await secrets.get("SHOPEE_PARTNER_ID")
  if (value === undefined) throw new ShopeeWorkerOAuthExchangeError("missing_partner_id")
  const parsed = ShopeePartnerIdSchema.safeParse(value)
  if (!parsed.success) throw new ShopeeWorkerOAuthExchangeError("invalid_partner_id")
  return parsed.data
}

async function readPartnerKey(secrets: ShopeeSecretProvider): Promise<string> {
  const value = await secrets.get("SHOPEE_PARTNER_KEY")
  if (value === undefined) throw new ShopeeWorkerOAuthExchangeError("missing_partner_key")
  const parsed = ShopeePartnerKeySchema.safeParse(value)
  if (!parsed.success) throw new ShopeeWorkerOAuthExchangeError("invalid_partner_key")
  return parsed.data
}

function assertNever(value: never): never {
  throw new Error(`Unexpected Shopee token exchange result: ${String(value)}`)
}
