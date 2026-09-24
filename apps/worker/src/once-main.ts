import { randomUUID } from "node:crypto"
import { Pool } from "pg"
import { createRuntimeBoundKmsEnvelopeCodec } from "../../../packages/oauth/src/credential-encryption.ts"
import { PostgresOAuthExchangeCommitter } from "../../../packages/oauth/src/postgres-oauth-exchange-committer.ts"
import { PostgresOAuthExchangeQueue } from "../../../packages/oauth/src/postgres-oauth-exchange-queue.ts"
import { runOAuthExchangeWorkerOnce } from "../../../packages/oauth/src/worker-handoff-runner.ts"
import {
  createPostgresExecutor,
  type PostgresPool,
  type PostgresPoolClient,
} from "../../../packages/persistence/src/postgres-executor.ts"
import { RUNTIME_POLICY_VERSION } from "../../../packages/runtime-boundaries/src/runtime-boundaries.ts"
import {
  createEnvironmentAesGcmEnvelopeBackend,
  parseWorkerCredentialEncryptionConfig,
  WorkerCredentialEncryptionConfigurationError,
} from "./adapters/environment-aes-gcm-envelope-backend.ts"
import { createEnvironmentShopeeSecretProvider } from "./adapters/environment-shopee-secret-provider.ts"
import { createWorkerShopeeHttpsOAuthTransport } from "./adapters/shopee-https-oauth-transport.ts"
import {
  parseWorkerShopeeLiveOAuthConfig,
  ShopeeLiveOAuthConfigError,
} from "./adapters/shopee-live-oauth-config.ts"
import { createWorkerShopeeOAuthExchangeProvider } from "./adapters/shopee-oauth-exchange-provider.ts"
import { parseWorkerOnceConfig, runWorkerOnce, WorkerOnceConfigurationError } from "./once.ts"

async function main(): Promise<void> {
  const configuration = parseWorkerOnceConfig(process.env)
  const credentialEncryptionConfiguration = parseWorkerCredentialEncryptionConfig(process.env)
  const shopeeConfiguration = parseWorkerShopeeLiveOAuthConfig(process.env)
  const pool = new Pool({
    connectionString: configuration.databaseUrl,
    max: 1,
    connectionTimeoutMillis: 12_000,
    query_timeout: 12_000,
  })

  try {
    const executor = createPostgresExecutor(asPostgresPool(pool))
    const kms = createRuntimeBoundKmsEnvelopeCodec({
      runtimeRole: "worker",
      policyVersion: RUNTIME_POLICY_VERSION,
      backend: createEnvironmentAesGcmEnvelopeBackend(credentialEncryptionConfiguration),
    })
    const committer = new PostgresOAuthExchangeCommitter({
      executor,
      kms,
      keyVersion: configuration.credentialEncryptionKeyVersion,
      now: () => new Date().toISOString(),
      nextIds: () => ({ credentialSubjectId: randomUUID(), grantId: randomUUID() }),
    })
    const provider = createWorkerShopeeOAuthExchangeProvider({
      baseUrl: shopeeConfiguration.baseUrl,
      now: Date.now,
      secrets: createEnvironmentShopeeSecretProvider(process.env),
      transport: createWorkerShopeeHttpsOAuthTransport(shopeeConfiguration),
      committer,
    })
    const queue = new PostgresOAuthExchangeQueue(executor)
    const workerId = randomUUID()
    const outcome = await runWorkerOnce(configuration, {
      runOnce: () =>
        runOAuthExchangeWorkerOnce(
          {
            workerId,
            runtimeRole: "worker",
            policyVersion: RUNTIME_POLICY_VERSION,
            now: new Date().toISOString(),
            leaseSeconds: configuration.leaseSeconds,
          },
          { queue, kms, provider, persistence: { kind: "provider_commits" } },
        ),
    })
    process.stdout.write(`${JSON.stringify({ event: "worker_once_finished", outcome })}\n`)
  } finally {
    await pool.end()
  }
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

function safeFailure(error: unknown): Record<string, string | readonly string[]> {
  if (error instanceof WorkerOnceConfigurationError) {
    return {
      event: "worker_once_rejected",
      reason: "worker_configuration_invalid",
      fields: error.fieldNames,
    }
  }
  if (error instanceof WorkerCredentialEncryptionConfigurationError) {
    return { event: "worker_once_rejected", reason: "credential_encryption_configuration_invalid" }
  }
  if (error instanceof ShopeeLiveOAuthConfigError) {
    return { event: "worker_once_rejected", reason: "shopee_configuration_invalid" }
  }
  return { event: "worker_once_failed", reason: "worker_execution_failed" }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${JSON.stringify(safeFailure(error))}\n`)
  process.exitCode = 1
})
