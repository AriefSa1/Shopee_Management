import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { KmsEncryptionContextSchema } from "../../../../packages/oauth/src/durable-contracts.ts"
import { CallbackCodeSchema } from "../../../../packages/oauth/src/model.ts"
import {
  createEnvironmentAesGcmEnvelopeBackend,
  parseWorkerCredentialEncryptionConfig,
  WorkerCredentialEncryptionConfigurationError,
} from "./environment-aes-gcm-envelope-backend.ts"

describe("environment AES-GCM envelope backend", () => {
  it("encrypts locally and requires the same non-secret context to decrypt", async () => {
    // Given: a worker-only 256-bit key and callback context without credential material.
    const config = parseWorkerCredentialEncryptionConfig({
      WORKER_CREDENTIAL_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    })
    const context = KmsEncryptionContextSchema.parse({
      purpose: "oauth_callback_code",
      organizationId: "00000000-0000-4000-8000-000000000001",
      partnerApplicationId: "partner-app-1",
      market: "ID",
    })
    const callbackCode = CallbackCodeSchema.parse("callback-code-fixture")
    const backend = createEnvironmentAesGcmEnvelopeBackend(config)

    // When: the worker seals then unseals a callback code with the exact context.
    const envelope = await backend.encrypt({
      plaintext: callbackCode,
      keyVersion: 1,
      encryptionContext: context,
    })
    const plaintext = await backend.decrypt({ envelope, encryptionContext: context })

    // Then: storage holds an opaque envelope and returns the original plaintext only for that context.
    assert.equal(envelope.algorithm, "kms-envelope-v1")
    assert.notEqual(envelope.ciphertext, "callback-code-fixture")
    assert.equal(plaintext, "callback-code-fixture")
  })

  it("rejects a key that is not exactly 256 bits without exposing it", () => {
    // Given: malformed environment input.
    const action = () =>
      parseWorkerCredentialEncryptionConfig({ WORKER_CREDENTIAL_ENCRYPTION_KEY: "short" })

    // When: the worker parses its encryption configuration.

    // Then: it returns only a typed configuration category.
    assert.throws(
      action,
      (error: unknown) =>
        error instanceof WorkerCredentialEncryptionConfigurationError &&
        error.reason === "invalid_configuration",
    )
  })

  it("rejects a callback envelope when its organization context changes", async () => {
    // Given: a locally encrypted callback envelope with its original organization context.
    const config = parseWorkerCredentialEncryptionConfig({
      WORKER_CREDENTIAL_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    })
    const originalContext = KmsEncryptionContextSchema.parse({
      purpose: "oauth_callback_code",
      organizationId: "00000000-0000-4000-8000-000000000001",
      partnerApplicationId: "partner-app-1",
      market: "ID",
    })
    const substitutedContext = KmsEncryptionContextSchema.parse({
      purpose: "oauth_callback_code",
      organizationId: "00000000-0000-4000-8000-000000000002",
      partnerApplicationId: "partner-app-1",
      market: "ID",
    })
    const backend = createEnvironmentAesGcmEnvelopeBackend(config)
    const envelope = await backend.encrypt({
      plaintext: CallbackCodeSchema.parse("callback-code-fixture"),
      keyVersion: 1,
      encryptionContext: originalContext,
    })

    // When: a different organization attempts to decrypt that envelope.
    const action = () => backend.decrypt({ envelope, encryptionContext: substitutedContext })

    // Then: AES-GCM authentication rejects the substituted associated data.
    await assert.rejects(action)
  })
})
