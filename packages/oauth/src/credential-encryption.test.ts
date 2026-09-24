import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { RUNTIME_POLICY_VERSION } from "../../runtime-boundaries/src/runtime-boundaries.ts"
import { CallbackCodeSchema } from "./model.ts"
import { createRuntimeBoundKmsEnvelopeCodec, KmsEnvelopeAccessError, type KmsEnvelopeBackend } from "./credential-encryption.ts"
import { KmsEncryptionContextSchema, type KmsEncryptionContext } from "./durable-contracts.ts"

const callbackCode = CallbackCodeSchema.parse("callback-code-canary")
const envelope = { keyVersion: 2, ciphertext: "ciphertext-fixture", algorithm: "kms-envelope-v1" as const }
const callbackContext = KmsEncryptionContextSchema.parse({
  purpose: "oauth_callback_code",
  organizationId: "60000000-0000-4000-8000-000000000001",
  partnerApplicationId: "partner-credentials",
  market: "ID",
})
const refreshContext = KmsEncryptionContextSchema.parse({
  purpose: "oauth_refresh_token",
  organizationId: "60000000-0000-4000-8000-000000000001",
  partnerApplicationId: "partner-credentials",
  credentialSubjectId: "60000000-0000-4000-8000-000000000011",
  market: "ID",
})

function backend(): KmsEnvelopeBackend {
  return {
    encrypt: async () => envelope,
    decrypt: async () => callbackCode,
  }
}

describe("runtime-bound KMS envelope contract", () => {
  it("allows web seal but never web unseal", async () => {
    const codec = createRuntimeBoundKmsEnvelopeCodec({ runtimeRole: "web", policyVersion: RUNTIME_POLICY_VERSION, backend: backend() })
    assert.deepEqual(await codec.seal(callbackCode, 2, callbackContext), envelope)
    await assert.rejects(codec.unseal(envelope, callbackContext), (error: unknown) => error instanceof KmsEnvelopeAccessError && error.reason === "unseal_capability_denied")
  })

  it("allows worker unseal and validates decrypted callback shape", async () => {
    let decrypts = 0
    const codec = createRuntimeBoundKmsEnvelopeCodec({
      runtimeRole: "worker",
      policyVersion: RUNTIME_POLICY_VERSION,
      backend: { encrypt: async () => envelope, decrypt: async () => { decrypts += 1; return callbackCode } },
    })
    assert.equal(await codec.unseal(envelope, refreshContext), callbackCode)
    assert.equal(decrypts, 1)
  })

  it("denies stale policy before backend decrypt and never returns provider errors", async () => {
    let decrypts = 0
    const codec = createRuntimeBoundKmsEnvelopeCodec({
      runtimeRole: "worker",
      policyVersion: "phase0_v1" as typeof RUNTIME_POLICY_VERSION,
      backend: { encrypt: async () => envelope, decrypt: async () => { decrypts += 1; throw new Error("kms secret detail") } },
    })
    await assert.rejects(codec.unseal(envelope, refreshContext), (error: unknown) => error instanceof KmsEnvelopeAccessError && error.reason === "unseal_capability_denied")
    assert.equal(decrypts, 0)
  })

  it("rejects malformed backend envelope and plaintext without exposing values", async () => {
    const malformed = createRuntimeBoundKmsEnvelopeCodec({
      runtimeRole: "web",
      policyVersion: RUNTIME_POLICY_VERSION,
      backend: { encrypt: async () => ({ keyVersion: 0 }), decrypt: async () => "not-used" },
    })
    await assert.rejects(malformed.seal(callbackCode, 1, callbackContext), (error: unknown) => error instanceof KmsEnvelopeAccessError && error.reason === "invalid_envelope")

    const invalidPlaintext = createRuntimeBoundKmsEnvelopeCodec({
      runtimeRole: "worker",
      policyVersion: RUNTIME_POLICY_VERSION,
      backend: { encrypt: async () => envelope, decrypt: async () => "" },
    })
    await assert.rejects(invalidPlaintext.unseal(envelope, refreshContext), (error: unknown) => error instanceof KmsEnvelopeAccessError && error.reason === "invalid_plaintext")
    assert.throws(() => { throw new KmsEnvelopeAccessError("backend_failure") }, (error: unknown) => error instanceof Error && !error.message.includes("kms secret detail"))
  })

  it("does not let migration or readonly support use KMS capabilities", async () => {
    for (const runtimeRole of ["migration", "readonly-support"] as const) {
      const codec = createRuntimeBoundKmsEnvelopeCodec({ runtimeRole, policyVersion: RUNTIME_POLICY_VERSION, backend: backend() })
      await assert.rejects(codec.unseal(envelope, refreshContext), (error: unknown) => error instanceof KmsEnvelopeAccessError && error.reason === "unseal_capability_denied")
    }
  })

  it("passes a typed encryption context as KMS AAD and rejects cross-subject substitution", async () => {
    let seenContext: KmsEncryptionContext | undefined
    const codec = createRuntimeBoundKmsEnvelopeCodec({
      runtimeRole: "worker",
      policyVersion: RUNTIME_POLICY_VERSION,
      backend: {
        encrypt: async ({ encryptionContext }) => {
          seenContext = encryptionContext
          return envelope
        },
        decrypt: async ({ encryptionContext }) => {
          if (JSON.stringify(encryptionContext) !== JSON.stringify(seenContext)) throw new Error("aad mismatch")
          return callbackCode
        },
      },
    })

    const sealed = await codec.seal(callbackCode, 2, refreshContext)
    assert.deepEqual(seenContext, refreshContext)
    assert.equal(await codec.unseal(sealed, refreshContext), callbackCode)

    const otherSubjectContext = KmsEncryptionContextSchema.parse({
      ...refreshContext,
      credentialSubjectId: "60000000-0000-4000-8000-000000000012",
    })
    await assert.rejects(codec.unseal(sealed, otherSubjectContext), (error: unknown) => error instanceof KmsEnvelopeAccessError && error.reason === "backend_failure")
  })
})
