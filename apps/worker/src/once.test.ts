import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { OAuthAttemptIdSchema } from "../../../packages/oauth/src/model.ts"
import type { OAuthExchangeWorkerResult } from "../../../packages/oauth/src/worker-handoff-runner.ts"
import { parseWorkerOnceConfig, runWorkerOnce, WorkerOnceConfigurationError } from "./once.ts"

describe("Hostinger cron worker once", () => {
  it("runs a bounded batch and exits after an idle queue", async () => {
    // Given: production worker configuration and one completed queue result.
    const results: readonly OAuthExchangeWorkerResult[] = [
      {
        kind: "completed",
        attemptId: OAuthAttemptIdSchema.parse("20000000-0000-4000-8000-000000000001"),
      },
      { kind: "idle" },
    ]
    let index = 0

    // When: a cron invocation runs with a bounded one-shot worker configuration.
    const outcome = await runWorkerOnce(
      {
        maximumClaims: 3,
        leaseSeconds: 60,
        credentialEncryptionKeyVersion: 1,
      },
      {
        runOnce: async () => {
          const result = results[index]
          if (result === undefined) throw new Error("unexpected worker invocation")
          index += 1
          return result
        },
      },
    )

    // Then: only the safe batch counters are returned after the queue becomes idle.
    assert.deepEqual(outcome, { kind: "idle", claimed: 1, completed: 1, failed: 0 })
  })

  it("rejects a missing production database URL by field name only", () => {
    // Given: a cron environment without the database connection string.
    const environment = { WORKER_ONCE_MAXIMUM_CLAIMS: "3" }

    // When: configuration is parsed before any provider call.
    const action = () => parseWorkerOnceConfig(environment)

    // Then: configuration fails without reflecting a secret value.
    assert.throws(
      action,
      (error: unknown) =>
        error instanceof WorkerOnceConfigurationError && error.fieldNames.includes("DATABASE_URL"),
    )
  })

  it("uses the local credential encryption key version instead of an AWS variable", () => {
    // Given: an otherwise valid worker environment with its local encryption key version.
    const environment = {
      DATABASE_URL: "postgresql://user:password@localhost:5432/shopee",
      CREDENTIAL_ENCRYPTION_KEY_VERSION: "2",
    }

    // When: the one-shot worker configuration is parsed.
    const config = parseWorkerOnceConfig(environment)

    // Then: the local key version is projected and no AWS variable is required.
    assert.equal(config.credentialEncryptionKeyVersion, 2)
  })
})
