import { z } from "zod"

const SHOPEE_LIVE_API_ORIGIN = "https://partner.shopeemobile.com" as const
const DEFAULT_TIMEOUT_MS = 12_000
const environmentSchema = z.object({
  SHOPEE_API_BASE_URL: z.string().url(),
  SHOPEE_OAUTH_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(30_000).default(DEFAULT_TIMEOUT_MS),
}).strict()

export type WorkerShopeeLiveOAuthConfig = {
  readonly baseUrl: string
  readonly requestTimeoutMs: number
}

export class ShopeeLiveOAuthConfigError extends Error {
  readonly name = "ShopeeLiveOAuthConfigError"
  readonly reason: "invalid_configuration" | "unapproved_origin"

  constructor(reason: ShopeeLiveOAuthConfigError["reason"]) {
    super("Shopee live OAuth configuration is invalid")
    this.reason = reason
  }
}

export function parseWorkerShopeeLiveOAuthConfig(
  environment: Readonly<Record<string, string | undefined>>,
): WorkerShopeeLiveOAuthConfig {
  const parsed = environmentSchema.safeParse({
    SHOPEE_API_BASE_URL: environment["SHOPEE_API_BASE_URL"],
    SHOPEE_OAUTH_TIMEOUT_MS: environment["SHOPEE_OAUTH_TIMEOUT_MS"],
  })
  if (!parsed.success) throw new ShopeeLiveOAuthConfigError("invalid_configuration")
  const url = new URL(parsed.data.SHOPEE_API_BASE_URL)
  if (
    url.origin !== SHOPEE_LIVE_API_ORIGIN
    || url.pathname !== "/"
    || url.search.length > 0
    || url.hash.length > 0
  ) {
    throw new ShopeeLiveOAuthConfigError("unapproved_origin")
  }
  return { baseUrl: `${url.origin}/`, requestTimeoutMs: parsed.data.SHOPEE_OAUTH_TIMEOUT_MS }
}
