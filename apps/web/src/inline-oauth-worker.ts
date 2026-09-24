import { createHmac, randomUUID } from "node:crypto"
import { z } from "zod"
import type { PostgresExecutor } from "../../../packages/delivery/src/postgres-delivery.ts"
import { OrganizationIdSchema, ShopIdSchema } from "../../../packages/identity/src/model.ts"
import {
  type ShopeeShopId,
  ShopeeShopIdSchema,
} from "../../../packages/integrations/src/shopee-oauth.ts"
import type {
  ShopeeCatalogAccess,
  ShopeeCatalogAccessResolver,
} from "../../../packages/integrations/src/shopee-product-catalog.ts"
import { ShopeeCatalogProviderError } from "../../../packages/integrations/src/shopee-product-catalog.ts"
import {
  buildShopeeShopInfoRequest,
  parseShopeeShopInfoResponse,
} from "../../../packages/integrations/src/shopee-shop-info.ts"
import { createRuntimeBoundKmsEnvelopeCodec } from "../../../packages/oauth/src/credential-encryption.ts"
import { KmsMarketSchema } from "../../../packages/oauth/src/durable-contracts.ts"
import {
  CredentialSubjectIdSchema,
  OAUTH_REFRESH_CREDENTIAL_TTL_SECONDS,
  OAuthMarketSchema,
  OAuthRefreshTokenSchema,
  PartnerApplicationIdSchema,
} from "../../../packages/oauth/src/model.ts"
import { PostgresCredentialRepository } from "../../../packages/oauth/src/postgres-credentials.ts"
import { PostgresOAuthExchangeCommitter } from "../../../packages/oauth/src/postgres-oauth-exchange-committer.ts"
import { PostgresOAuthExchangeQueue } from "../../../packages/oauth/src/postgres-oauth-exchange-queue.ts"
import { executeWorkerOnlyPostgresCredentialRefresh } from "../../../packages/oauth/src/postgres-worker-refresh.ts"
import { runOAuthExchangeWorkerOnce } from "../../../packages/oauth/src/worker-handoff-runner.ts"
import { RUNTIME_POLICY_VERSION } from "../../../packages/runtime-boundaries/src/runtime-boundaries.ts"
import {
  createEnvironmentAesGcmEnvelopeBackend,
  parseWorkerCredentialEncryptionConfig,
} from "../../worker/src/adapters/environment-aes-gcm-envelope-backend.ts"
import { createEnvironmentShopeeSecretProvider } from "../../worker/src/adapters/environment-shopee-secret-provider.ts"
import { createWorkerShopeeHttpsOAuthTransport } from "../../worker/src/adapters/shopee-https-oauth-transport.ts"
import { parseWorkerShopeeLiveOAuthConfig } from "../../worker/src/adapters/shopee-live-oauth-config.ts"
import { createWorkerShopeeOAuthExchangeProvider } from "../../worker/src/adapters/shopee-oauth-exchange-provider.ts"
import { parseWorkerOnceConfig, runWorkerOnce } from "../../worker/src/once.ts"

const DEFAULT_INTERVAL_MS = 30_000
const REFRESH_PATH = "/api/v2/auth/access_token/get"

type InlineWorkerHandle = { readonly stop: () => Promise<void> }

export function startInlineOAuthWorker(input: {
  readonly environment: NodeJS.ProcessEnv
  readonly executor: PostgresExecutor
}): InlineWorkerHandle {
  const config = parseWorkerOnceConfig(input.environment)
  const encryption = parseWorkerCredentialEncryptionConfig(input.environment)
  const shopee = parseWorkerShopeeLiveOAuthConfig(input.environment)
  const kms = createRuntimeBoundKmsEnvelopeCodec({
    runtimeRole: "worker",
    policyVersion: RUNTIME_POLICY_VERSION,
    backend: createEnvironmentAesGcmEnvelopeBackend(encryption),
  })
  const committer = new PostgresOAuthExchangeCommitter({
    executor: input.executor,
    kms,
    keyVersion: config.credentialEncryptionKeyVersion,
    now: () => new Date().toISOString(),
    nextIds: () => ({ credentialSubjectId: randomUUID(), grantId: randomUUID() }),
  })
  const provider = createWorkerShopeeOAuthExchangeProvider({
    baseUrl: shopee.baseUrl,
    now: Date.now,
    secrets: createEnvironmentShopeeSecretProvider(input.environment),
    transport: createWorkerShopeeHttpsOAuthTransport(shopee),
    committer,
  })
  const queue = new PostgresOAuthExchangeQueue(input.executor)
  let running = false
  let stopped = false
  const run = async (): Promise<void> => {
    if (running || stopped) return
    running = true
    try {
      const outcome = await runWorkerOnce(config, {
        runOnce: () =>
          runOAuthExchangeWorkerOnce(
            {
              workerId: `inline-web-${randomUUID()}`,
              runtimeRole: "worker",
              policyVersion: RUNTIME_POLICY_VERSION,
              now: new Date().toISOString(),
              leaseSeconds: config.leaseSeconds,
            },
            { queue, kms, provider, persistence: { kind: "provider_commits" } },
          ),
      })
      if (outcome.claimed > 0)
        process.stdout.write(`${JSON.stringify({ event: "inline_worker_finished", outcome })}\n`)
    } catch {
      process.stderr.write(`${JSON.stringify({ event: "inline_worker_failed" })}\n`)
    } finally {
      running = false
    }
  }
  const intervalMs = parseInterval(input.environment["INLINE_WORKER_INTERVAL_MS"])
  const timer = setInterval(() => void run(), intervalMs)
  void run()
  return {
    async stop(): Promise<void> {
      stopped = true
      clearInterval(timer)
      while (running) await new Promise((resolve) => setTimeout(resolve, 25))
    },
  }
}

export function createInlineCatalogAccessResolver(input: {
  readonly environment: NodeJS.ProcessEnv
  readonly executor: PostgresExecutor
}): ShopeeCatalogAccessResolver {
  const encryption = parseWorkerCredentialEncryptionConfig(input.environment)
  const partnerId = requiredEnvironment(input.environment, "SHOPEE_PARTNER_ID")
  const partnerKey = requiredEnvironment(input.environment, "SHOPEE_PARTNER_KEY")
  const baseUrl = requiredEnvironment(input.environment, "SHOPEE_API_BASE_URL")
  const keyVersion = Number(input.environment["CREDENTIAL_ENCRYPTION_KEY_VERSION"] ?? "1")
  const kms = createRuntimeBoundKmsEnvelopeCodec({
    runtimeRole: "worker",
    policyVersion: RUNTIME_POLICY_VERSION,
    backend: createEnvironmentAesGcmEnvelopeBackend(encryption),
  })
  const credentials = new PostgresCredentialRepository(input.executor)
  return async (shopId): Promise<ShopeeCatalogAccess> => {
    const internalShopId = ShopIdSchema.parse(shopId)
    const rows = await input.executor.query({
      name: "catalog.inline_access.binding",
      text: `SELECT sc.organization_id, sc.external_shop_id, sc.partner_application_id, sc.market,
        sc.shop_name, scb.credential_subject_id, cs.revision
        FROM shop_connections sc
        INNER JOIN shop_credential_bindings scb ON scb.organization_id = sc.organization_id
          AND scb.shop_id = sc.id AND scb.status = 'active'
        INNER JOIN credential_subjects cs ON cs.organization_id = sc.organization_id
          AND cs.credential_subject_id = scb.credential_subject_id AND cs.status = 'active'
        WHERE sc.id = $1 AND sc.status = 'active'
        ORDER BY cs.expires_at DESC
        LIMIT 1`,
      params: [internalShopId],
    })
    const row = rows[0]
    if (row === undefined) throw new ShopeeCatalogProviderError("catalog_access_not_bound")
    const organizationId = OrganizationIdSchema.parse(row["organization_id"])
    const externalShopId = ShopeeShopIdSchema.parse(row["external_shop_id"])
    const partnerApplicationId = PartnerApplicationIdSchema.parse(row["partner_application_id"])
    const market = KmsMarketSchema.parse(OAuthMarketSchema.parse(row["market"]))
    const subjectId = CredentialSubjectIdSchema.parse(row["credential_subject_id"])
    const revision = numberValue(row["revision"])
    let accessToken: string | undefined
    const result = await executeWorkerOnlyPostgresCredentialRefresh(
      {
        runtimeRole: "worker",
        policyVersion: RUNTIME_POLICY_VERSION,
        organizationId,
        partnerApplicationId,
        market,
        credentialSubjectId: subjectId,
        expectedRevision: revision,
        keyVersion,
      },
      {
        credentials,
        kms,
        provider: {
          refresh: async ({ refreshToken }) => {
            const response = await refreshAccessToken({
              baseUrl,
              partnerId,
              partnerKey,
              externalShopId,
              refreshToken,
            })
            accessToken = response.accessToken
            return response
          },
        },
        now: () => new Date().toISOString(),
      },
    )
    if (result.kind !== "rotated")
      throw new ShopeeCatalogProviderError(`catalog_access_refresh_failed_${result.reason}`)
    if (accessToken === undefined)
      throw new ShopeeCatalogProviderError("catalog_access_refresh_missing_token")
    const existingShopName = row["shop_name"]
    if (typeof existingShopName !== "string" || existingShopName.trim().length === 0) {
      await backfillShopName({
        executor: input.executor,
        baseUrl,
        partnerId,
        partnerKey,
        accessToken,
        externalShopId,
        internalShopId,
      })
    }
    return { accessToken, shop: { externalShopId, market } }
  }
}

/**
 * Best-effort enrichment of a connected shop's display name (Shopee
 * get_shop_info), run when a catalog access refresh happens and the stored name
 * is still missing. It backfills shops connected before name capture existed. It
 * must never throw: a failure leaves the name unset and the catalog read
 * proceeds normally.
 */
async function backfillShopName(input: {
  readonly executor: PostgresExecutor
  readonly baseUrl: string
  readonly partnerId: string
  readonly partnerKey: string
  readonly accessToken: string
  readonly externalShopId: ShopeeShopId
  readonly internalShopId: string
}): Promise<void> {
  try {
    const request = buildShopeeShopInfoRequest({
      baseUrl: input.baseUrl,
      partnerId: input.partnerId,
      partnerKey: input.partnerKey,
      accessToken: input.accessToken,
      shopId: input.externalShopId,
      timestamp: Math.floor(Date.now() / 1_000),
    })
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    let shopName: string | undefined
    try {
      const response = await fetch(request.url, {
        method: "GET",
        headers: { accept: "application/json" },
        signal: controller.signal,
      })
      const result = parseShopeeShopInfoResponse(await response.json())
      if (result.kind === "succeeded") shopName = result.shopName
    } finally {
      clearTimeout(timer)
    }
    const trimmed = shopName?.trim()
    if (trimmed === undefined || trimmed.length === 0) return
    await input.executor.query({
      name: "catalog.inline_access.backfill_shop_name",
      text: "UPDATE shop_connections SET shop_name = $2 WHERE id = $1 AND (shop_name IS NULL OR shop_name = '')",
      params: [input.internalShopId, trimmed.slice(0, 255)],
    })
  } catch {
    // no-excuse-ok: shop-name backfill is best-effort and must never fail a catalog read.
  }
}

async function refreshAccessToken(input: {
  readonly baseUrl: string
  readonly partnerId: string
  readonly partnerKey: string
  readonly externalShopId: ShopeeShopId
  readonly refreshToken: string
}): Promise<{
  readonly accessToken: string
  readonly refreshToken: ReturnType<typeof OAuthRefreshTokenSchema.parse>
  readonly expiresAt: string
}> {
  const timestamp = Math.floor(Date.now() / 1_000)
  const sign = createHmac("sha256", input.partnerKey)
    .update(`${input.partnerId}${REFRESH_PATH}${timestamp}`)
    .digest("hex")
  const url = new URL(REFRESH_PATH, input.baseUrl)
  url.searchParams.set("partner_id", input.partnerId)
  url.searchParams.set("timestamp", String(timestamp))
  url.searchParams.set("sign", sign)
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      partner_id: Number(input.partnerId),
      shop_id: Number(input.externalShopId),
      refresh_token: input.refreshToken,
    }),
  })
  const body = z
    .object({
      access_token: z.string().trim().min(1),
      refresh_token: z.string().trim().min(1),
      expire_in: z.number().int().positive(),
    })
    .safeParse(await response.json())
  if (!response.ok || !body.success)
    throw new ShopeeCatalogProviderError("catalog_access_refresh_failed")
  return {
    accessToken: body.data.access_token,
    refreshToken: OAuthRefreshTokenSchema.parse(body.data.refresh_token),
    expiresAt: new Date(Date.now() + OAUTH_REFRESH_CREDENTIAL_TTL_SECONDS * 1_000).toISOString(),
  }
}

function requiredEnvironment(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]
  if (value === undefined || value.trim() === "") throw new Error(`missing_${name.toLowerCase()}`)
  return value
}

function numberValue(value: unknown): number {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value
  // PostgreSQL bigint columns (e.g. `revision`) arrive as decimal strings via `pg`.
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    const parsed = Number(value.trim())
    if (Number.isSafeInteger(parsed)) return parsed
  }
  throw new Error("invalid_credential_revision")
}

function parseInterval(value: string | undefined): number {
  const interval = Number(value ?? DEFAULT_INTERVAL_MS)
  if (!Number.isInteger(interval) || interval < 5_000 || interval > 300_000)
    throw new Error("invalid_inline_worker_interval")
  return interval
}
