import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { serve } from "@hono/node-server"
import { Pool } from "pg"
import {
  ConfigValidationError,
  parseWebConfig,
} from "../../../packages/config/src/runtime-config.ts"
import { createShopeeAdsReader } from "../../../packages/integrations/src/shopee-ads.ts"
import { createShopeeMarketingInsightsReader } from "../../../packages/integrations/src/shopee-business-insights.ts"
import { createShopeeCatalogAdapter } from "../../../packages/integrations/src/shopee-product-catalog.ts"
import { createShopeeProductDetailReader } from "../../../packages/integrations/src/shopee-product-detail.ts"
import { createConfiguredDatabaseReadinessProbe } from "../../../packages/persistence/src/configured-database-readiness.ts"
import {
  createPostgresExecutor,
  type PostgresPool,
  type PostgresPoolClient,
} from "../../../packages/persistence/src/postgres-executor.ts"
import type { StagingApiDependencies } from "../../../packages/staging/src/staging-api.ts"
import { WorkerCredentialEncryptionConfigurationError } from "../../worker/src/adapters/environment-aes-gcm-envelope-backend.ts"
import { createWebApp } from "./app.ts"
import { createInlineCatalogAccessResolver, startInlineOAuthWorker } from "./inline-oauth-worker.ts"
import {
  createInternalSessionService,
  InternalSessionConfigurationError,
  parseInternalSessionConfig,
} from "./internal-session.ts"
import {
  createLiveOAuthWebDependencies,
  LiveOAuthWebConfigurationError,
  parseLiveOAuthWebConfig,
} from "./live-oauth-web.ts"
import { createProductionWebApp } from "./production-app.ts"

/**
 * The web process does not own actor, organization, shop, or staging-state
 * authority yet. Keep the route composed at the server boundary while every
 * request remains fail-closed until those dependencies are injected.
 */
export function createFailClosedStagingDependencies(): StagingApiDependencies {
  return {
    authenticate: () => null,
    read: async () => null,
  }
}

function resolveSpaPublicDir(): string | undefined {
  const dir = fileURLToPath(new URL("../public", import.meta.url))
  return existsSync(`${dir}/index.html`) ? dir : undefined
}

function start(): void {
  const config = parseWebConfig(process.env)
  const database = createConfiguredDatabaseReadinessProbe(config.databaseUrl)
  const spaPublicDir = resolveSpaPublicDir()
  const liveOAuthFlag = process.env["SHOPEE_LIVE_OAUTH_ENABLED"] ?? "false"
  if (liveOAuthFlag !== "true" && liveOAuthFlag !== "false") {
    throw new ConfigValidationError(["SHOPEE_LIVE_OAUTH_ENABLED"])
  }
  const liveOAuthEnabled = liveOAuthFlag === "true"
  let app = createWebApp(
    database,
    undefined,
    undefined,
    createFailClosedStagingDependencies(),
    undefined,
    undefined,
    undefined,
    undefined,
    spaPublicDir,
  )
  if (liveOAuthEnabled) {
    if (config.databaseUrl === undefined) throw new ConfigValidationError(["DATABASE_URL"])
    const sessionConfig = parseInternalSessionConfig(process.env)
    const oauthConfig = parseLiveOAuthWebConfig(process.env)
    const session = createInternalSessionService(sessionConfig)
    const pool = new Pool({
      connectionString: config.databaseUrl,
      max: 5,
      connectionTimeoutMillis: 12_000,
      query_timeout: 12_000,
    })
    const executor = createPostgresExecutor(asPostgresPool(pool))
    // One shared access resolver across every Shopee reader so its per-shop token
    // cache and in-flight de-duplication span all endpoints, and the parallel
    // requests fired on first page load trigger a single credential refresh.
    const resolveAccess = createInlineCatalogAccessResolver({ environment: process.env, executor })
    app = createProductionWebApp({
      database,
      ...(spaPublicDir === undefined ? {} : { spaPublicDir }),
      session,
      connection: {
        organizationId: sessionConfig.organizationId,
        partnerApplicationId: oauthConfig.partnerApplicationId,
        market: "ID",
      },
      oauth: createLiveOAuthWebDependencies({
        config: oauthConfig,
        executor,
        session,
      }),
      executor,
      catalog: {
        adapter: createShopeeCatalogAdapter({
          baseUrl: "https://partner.shopeemobile.com",
          partnerId: oauthConfig.partnerId,
          partnerKey: process.env["SHOPEE_PARTNER_KEY"] ?? "",
          resolveAccess,
        }),
        collectedAt: new Date().toISOString(),
        authenticate: () => null,
      },
      productDetailReader: createShopeeProductDetailReader({
        baseUrl: "https://partner.shopeemobile.com",
        partnerId: oauthConfig.partnerId,
        partnerKey: process.env["SHOPEE_PARTNER_KEY"] ?? "",
        resolveAccess,
      }),
      marketingInsightsReader: createShopeeMarketingInsightsReader({
        baseUrl: "https://partner.shopeemobile.com",
        partnerId: oauthConfig.partnerId,
        partnerKey: process.env["SHOPEE_PARTNER_KEY"] ?? "",
        resolveAccess,
      }),
      adsReader: createShopeeAdsReader({
        baseUrl: "https://partner.shopeemobile.com",
        partnerId: oauthConfig.partnerId,
        partnerKey: process.env["SHOPEE_PARTNER_KEY"] ?? "",
        resolveAccess,
      }),
    })
    if (process.env["INLINE_WORKER_ENABLED"] === "true") {
      startInlineOAuthWorker({ environment: process.env, executor })
    }
  }

  serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
    process.stdout.write(
      `${JSON.stringify({ event: "listening", service: config.service, host: info.address, port: info.port })}\n`,
    )
  })
}

function asPostgresPool(pool: Pool): PostgresPool {
  return {
    async connect(): Promise<PostgresPoolClient> {
      const client = await pool.connect()
      return {
        async query(text, params = []) {
          const result = await client.query(text, [...params])
          return { rows: result.rows }
        },
        release() {
          client.release()
        },
      }
    },
  }
}

try {
  start()
} catch (error) {
  // no-excuse-ok: catch - process entrypoint converts safe typed configuration failures.
  if (
    error instanceof ConfigValidationError ||
    error instanceof InternalSessionConfigurationError ||
    error instanceof LiveOAuthWebConfigurationError
  ) {
    process.stderr.write(
      `${JSON.stringify({ event: "startup_rejected", error: error.name, fields: error.fieldNames })}\n`,
    )
    process.exitCode = 1
  } else if (error instanceof WorkerCredentialEncryptionConfigurationError) {
    process.stderr.write(
      `${JSON.stringify({ event: "startup_rejected", error: error.name, fields: ["WORKER_CREDENTIAL_ENCRYPTION_KEY"] })}\n`,
    )
    process.exitCode = 1
  } else {
    throw error
  }
}
