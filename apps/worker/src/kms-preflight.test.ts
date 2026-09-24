import assert from "node:assert/strict"
import test from "node:test"
import type { KmsEnvelopeCodec } from "../../../packages/oauth/src/durable-contracts.ts"
import { CallbackCodeSchema } from "../../../packages/oauth/src/model.ts"
import { runWorkerKmsPreflight, WorkerKmsPreflightError } from "./kms-preflight.ts"

test("runs a worker-only KMS envelope round trip with a non-secret context", async () => {
  const contexts: unknown[] = []
  const codec: KmsEnvelopeCodec = {
    async seal(plaintext, keyVersion, context) {
      contexts.push(context)
      assert.equal(plaintext, "worker-kms-preflight")
      assert.equal(keyVersion, 1)
      return { keyVersion, ciphertext: "safe-envelope", algorithm: "kms-envelope-v1" }
    },
    async unseal(envelope, context) {
      contexts.push(context)
      assert.equal(envelope.ciphertext, "safe-envelope")
      return CallbackCodeSchema.parse("worker-kms-preflight")
    },
  }

  const result = await runWorkerKmsPreflight({ codec, keyVersion: 1 })

  assert.deepEqual(result, { status: "passed", keyVersion: 1 })
  assert.deepEqual(contexts, [
    {
      purpose: "oauth_callback_code",
      organizationId: "00000000-0000-4000-8000-000000000001",
      partnerApplicationId: "worker-kms-preflight",
      market: "ID",
    },
    {
      purpose: "oauth_callback_code",
      organizationId: "00000000-0000-4000-8000-000000000001",
      partnerApplicationId: "worker-kms-preflight",
      market: "ID",
    },
  ])
})

test("rejects an invalid worker KMS key version before contacting the backend", async () => {
  const codec: KmsEnvelopeCodec = {
    async seal() {
      throw new Error("seal must not run")
    },
    async unseal() {
      throw new Error("unseal must not run")
    },
  }

  await assert.rejects(
    () => runWorkerKmsPreflight({ codec, keyVersion: 0 }),
    (error: unknown) =>
      error instanceof WorkerKmsPreflightError && error.reason === "invalid_key_version",
  )
})
