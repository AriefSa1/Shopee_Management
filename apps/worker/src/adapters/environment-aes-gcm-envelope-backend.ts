import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import { z } from "zod"
import type { KmsEnvelopeBackend } from "../../../../packages/oauth/src/credential-encryption.ts"
import type {
  EncryptedCredentialEnvelope,
  KmsEncryptionContext,
  KmsPlaintext,
} from "../../../../packages/oauth/src/durable-contracts.ts"

const environmentSchema = z.object({
  WORKER_CREDENTIAL_ENCRYPTION_KEY: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{43}$/),
})

const nonceLength = 12
const authenticationTagLength = 16

export type WorkerCredentialEncryptionConfig = {
  readonly key: Buffer
}

export type EnvironmentAesGcmEnvelopeBackend = {
  readonly encrypt: (input: {
    readonly plaintext: KmsPlaintext
    readonly keyVersion: number
    readonly encryptionContext: KmsEncryptionContext
  }) => Promise<EncryptedCredentialEnvelope>
  readonly decrypt: (input: {
    readonly envelope: EncryptedCredentialEnvelope
    readonly encryptionContext: KmsEncryptionContext
  }) => Promise<string>
}

export class WorkerCredentialEncryptionConfigurationError extends Error {
  readonly name = "WorkerCredentialEncryptionConfigurationError"
  readonly reason: "invalid_configuration"

  constructor(reason: WorkerCredentialEncryptionConfigurationError["reason"]) {
    super("Worker credential encryption configuration is invalid")
    this.reason = reason
  }
}

export class WorkerCredentialEncryptionBackendError extends Error {
  readonly name = "WorkerCredentialEncryptionBackendError"
  readonly reason: "invalid_envelope"

  constructor(reason: WorkerCredentialEncryptionBackendError["reason"]) {
    super("Worker credential encryption envelope is invalid")
    this.reason = reason
  }
}

export function parseWorkerCredentialEncryptionConfig(
  environment: Readonly<Record<string, string | undefined>>,
): WorkerCredentialEncryptionConfig {
  const parsed = environmentSchema.safeParse({
    WORKER_CREDENTIAL_ENCRYPTION_KEY: environment["WORKER_CREDENTIAL_ENCRYPTION_KEY"],
  })
  if (!parsed.success)
    throw new WorkerCredentialEncryptionConfigurationError("invalid_configuration")
  const key = Buffer.from(parsed.data.WORKER_CREDENTIAL_ENCRYPTION_KEY, "base64url")
  if (
    key.byteLength !== 32 ||
    key.toString("base64url") !== parsed.data.WORKER_CREDENTIAL_ENCRYPTION_KEY
  ) {
    throw new WorkerCredentialEncryptionConfigurationError("invalid_configuration")
  }
  return { key }
}

export function createEnvironmentAesGcmEnvelopeBackend(
  config: WorkerCredentialEncryptionConfig,
): EnvironmentAesGcmEnvelopeBackend & KmsEnvelopeBackend {
  return {
    async encrypt(input): Promise<EncryptedCredentialEnvelope> {
      const nonce = randomBytes(nonceLength)
      const cipher = createCipheriv("aes-256-gcm", config.key, nonce)
      cipher.setAAD(associatedData(input.encryptionContext))
      const ciphertext = Buffer.concat([cipher.update(input.plaintext, "utf8"), cipher.final()])
      const envelope = Buffer.concat([cipher.getAuthTag(), ciphertext])
      return {
        keyVersion: input.keyVersion,
        ciphertext: Buffer.concat([nonce, envelope]).toString("base64url"),
        algorithm: "kms-envelope-v1",
      }
    },
    async decrypt(input): Promise<string> {
      const encrypted = parseEnvelope(input.envelope)
      const nonce = encrypted.subarray(0, nonceLength)
      const authenticationTag = encrypted.subarray(
        nonceLength,
        nonceLength + authenticationTagLength,
      )
      const ciphertext = encrypted.subarray(nonceLength + authenticationTagLength)
      const decipher = createDecipheriv("aes-256-gcm", config.key, nonce)
      decipher.setAAD(associatedData(input.encryptionContext))
      decipher.setAuthTag(authenticationTag)
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8")
    },
  }
}

function parseEnvelope(envelope: EncryptedCredentialEnvelope): Buffer {
  const decoded = Buffer.from(envelope.ciphertext, "base64url")
  if (decoded.byteLength <= nonceLength + authenticationTagLength) {
    throw new WorkerCredentialEncryptionBackendError("invalid_envelope")
  }
  return decoded
}

function associatedData(context: KmsEncryptionContext): Buffer {
  switch (context.purpose) {
    case "oauth_callback_code":
      return Buffer.from(
        JSON.stringify({
          purpose: context.purpose,
          organizationId: context.organizationId,
          partnerApplicationId: context.partnerApplicationId,
          market: context.market,
        }),
        "utf8",
      )
    case "oauth_refresh_token":
      return Buffer.from(
        JSON.stringify({
          purpose: context.purpose,
          organizationId: context.organizationId,
          partnerApplicationId: context.partnerApplicationId,
          credentialSubjectId: context.credentialSubjectId,
          market: context.market,
        }),
        "utf8",
      )
    default:
      return assertNever(context)
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unhandled credential encryption context: ${String(value)}`)
}
