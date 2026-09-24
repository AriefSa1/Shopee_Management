import { z } from "zod"
import {
  type OAuthExchangeWorkerBatchDependencies,
  type OAuthExchangeWorkerBatchResult,
  runOAuthExchangeWorkerBatch,
} from "../../../packages/oauth/src/worker-handoff-runner.ts"

const environmentSchema = z.object({
  DATABASE_URL: z.string().url(),
  WORKER_ONCE_MAXIMUM_CLAIMS: z.coerce.number().int().min(1).max(10).default(3),
  WORKER_LEASE_SECONDS: z.coerce.number().int().min(30).max(300).default(60),
  CREDENTIAL_ENCRYPTION_KEY_VERSION: z.coerce.number().int().positive().default(1),
})

export type WorkerOnceExecutionConfig = {
  readonly maximumClaims: number
  readonly leaseSeconds: number
  readonly credentialEncryptionKeyVersion: number
}

export type WorkerOnceConfig = WorkerOnceExecutionConfig & {
  readonly databaseUrl: string
}

export class WorkerOnceConfigurationError extends Error {
  readonly name = "WorkerOnceConfigurationError"
  readonly fieldNames: readonly string[]

  constructor(fieldNames: readonly string[]) {
    super("Worker once configuration is invalid")
    this.fieldNames = fieldNames
  }
}

export function parseWorkerOnceConfig(
  environment: Readonly<Record<string, string | undefined>>,
): WorkerOnceConfig {
  const parsed = environmentSchema.safeParse({
    DATABASE_URL: environment["DATABASE_URL"],
    WORKER_ONCE_MAXIMUM_CLAIMS: environment["WORKER_ONCE_MAXIMUM_CLAIMS"],
    WORKER_LEASE_SECONDS: environment["WORKER_LEASE_SECONDS"],
    CREDENTIAL_ENCRYPTION_KEY_VERSION: environment["CREDENTIAL_ENCRYPTION_KEY_VERSION"],
  })
  if (!parsed.success) {
    throw new WorkerOnceConfigurationError([
      ...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? "environment"))),
    ])
  }
  return {
    databaseUrl: parsed.data.DATABASE_URL,
    maximumClaims: parsed.data.WORKER_ONCE_MAXIMUM_CLAIMS,
    leaseSeconds: parsed.data.WORKER_LEASE_SECONDS,
    credentialEncryptionKeyVersion: parsed.data.CREDENTIAL_ENCRYPTION_KEY_VERSION,
  }
}

export async function runWorkerOnce(
  config: WorkerOnceExecutionConfig,
  dependencies: OAuthExchangeWorkerBatchDependencies,
): Promise<OAuthExchangeWorkerBatchResult> {
  return runOAuthExchangeWorkerBatch({ maximumClaims: config.maximumClaims }, dependencies)
}
