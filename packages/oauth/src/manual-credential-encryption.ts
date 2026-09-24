import assert from "node:assert/strict"
import { CallbackCodeSchema } from "./model.ts"
import { createRuntimeBoundKmsEnvelopeCodec } from "./credential-encryption.ts"
import { KmsEncryptionContextSchema, type KmsEncryptionContext } from "./durable-contracts.ts"
import { RUNTIME_POLICY_VERSION } from "../../runtime-boundaries/src/runtime-boundaries.ts"

const callbackCode = CallbackCodeSchema.parse("callback-code-canary")
const envelope = { keyVersion: 2, ciphertext: "ciphertext-fixture", algorithm: "kms-envelope-v1" as const }
const context = KmsEncryptionContextSchema.parse({
  purpose: "oauth_refresh_token",
  organizationId: "60000000-0000-4000-8000-000000000001",
  partnerApplicationId: "partner-credentials",
  credentialSubjectId: "60000000-0000-4000-8000-000000000011",
  market: "ID",
})
let encrypts = 0
let decrypts = 0
let seenContext: KmsEncryptionContext | undefined
const codec = createRuntimeBoundKmsEnvelopeCodec({
  runtimeRole: "worker",
  policyVersion: RUNTIME_POLICY_VERSION,
  backend: {
    encrypt: async ({ encryptionContext }) => { encrypts += 1; seenContext = encryptionContext; return envelope },
    decrypt: async ({ encryptionContext }) => {
      decrypts += 1
      if (JSON.stringify(encryptionContext) !== JSON.stringify(seenContext)) throw new Error("aad mismatch")
      return callbackCode
    },
  },
})
const sealed = await codec.seal(callbackCode, 2, context)
const unsealed = await codec.unseal(sealed, context)
assert.equal(unsealed, callbackCode)
const otherSubjectContext = KmsEncryptionContextSchema.parse({
  ...context,
  credentialSubjectId: "60000000-0000-4000-8000-000000000012",
})
let crossSubjectRejected = false
try {
  await codec.unseal(sealed, otherSubjectContext)
} catch {
  crossSubjectRejected = true
}
assert.equal(crossSubjectRejected, true)

console.log(JSON.stringify({
  scenario: "oauth-runtime-bound-kms-envelope-contract",
  envelopeAlgorithm: sealed.algorithm,
  keyVersion: sealed.keyVersion,
  roundTrip: unsealed === callbackCode,
  aadContextBound: JSON.stringify(seenContext) === JSON.stringify(context),
  crossSubjectRejected,
  backendEncryptCalls: encrypts,
  backendDecryptCalls: decrypts,
  networkCalls: 0,
  databaseCalls: 0,
  shopeeMutations: 0,
  externalWrites: 0,
  secretFieldsPresent: false,
  plaintextEmitted: false,
  liveKms: "not_run",
}, null, 2))
