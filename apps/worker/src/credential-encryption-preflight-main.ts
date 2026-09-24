import { z } from "zod"
import { createRuntimeBoundKmsEnvelopeCodec } from "../../../packages/oauth/src/credential-encryption.ts"
import { RUNTIME_POLICY_VERSION } from "../../../packages/runtime-boundaries/src/runtime-boundaries.ts"
import {
  createEnvironmentAesGcmEnvelopeBackend,
  parseWorkerCredentialEncryptionConfig,
  WorkerCredentialEncryptionConfigurationError,
} from "./adapters/environment-aes-gcm-envelope-backend.ts"
import { runWorkerKmsPreflight, WorkerKmsPreflightError } from "./kms-preflight.ts"

const environmentSchema = z.object({
  CREDENTIAL_ENCRYPTION_KEY_VERSION: z.coerce.number().int().positive().default(1),
})

class WorkerCredentialEncryptionPreflightConfigurationError extends Error {
  readonly name = "WorkerCredentialEncryptionPreflightConfigurationError"

  constructor() {
    super("Worker credential encryption preflight configuration is invalid")
  }
}

async function main(): Promise<void> {
  const parsed = environmentSchema.safeParse({
    CREDENTIAL_ENCRYPTION_KEY_VERSION: process.env["CREDENTIAL_ENCRYPTION_KEY_VERSION"],
  })
  if (!parsed.success) throw new WorkerCredentialEncryptionPreflightConfigurationError()
  const credentialEncryptionConfiguration = parseWorkerCredentialEncryptionConfig(process.env)
  const codec = createRuntimeBoundKmsEnvelopeCodec({
    runtimeRole: "worker",
    policyVersion: RUNTIME_POLICY_VERSION,
    backend: createEnvironmentAesGcmEnvelopeBackend(credentialEncryptionConfiguration),
  })
  const result = await runWorkerKmsPreflight({
    codec,
    keyVersion: parsed.data.CREDENTIAL_ENCRYPTION_KEY_VERSION,
  })
  process.stdout.write(
    `${JSON.stringify({ event: "worker_credential_encryption_preflight_finished", result })}\n`,
  )
}

function safeFailure(error: unknown): Record<string, string> {
  if (error instanceof WorkerCredentialEncryptionPreflightConfigurationError) {
    return {
      event: "worker_credential_encryption_preflight_rejected",
      reason: "key_version_invalid",
    }
  }
  if (error instanceof WorkerCredentialEncryptionConfigurationError) {
    return {
      event: "worker_credential_encryption_preflight_rejected",
      reason: "credential_encryption_configuration_invalid",
    }
  }
  if (error instanceof WorkerKmsPreflightError) {
    return { event: "worker_credential_encryption_preflight_failed", reason: error.reason }
  }
  return {
    event: "worker_credential_encryption_preflight_failed",
    reason: "encryption_operation_failed",
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${JSON.stringify(safeFailure(error))}\n`)
  process.exitCode = 1
})
