import {
  KmsEncryptionContextSchema,
  type KmsEnvelopeCodec,
} from "../../../packages/oauth/src/durable-contracts.ts"
import { CallbackCodeSchema } from "../../../packages/oauth/src/model.ts"

const preflightContext = KmsEncryptionContextSchema.parse({
  purpose: "oauth_callback_code",
  organizationId: "00000000-0000-4000-8000-000000000001",
  partnerApplicationId: "worker-kms-preflight",
  market: "ID",
})

const preflightPlaintext = CallbackCodeSchema.parse("worker-kms-preflight")

export type WorkerKmsPreflightResult = {
  readonly status: "passed"
  readonly keyVersion: number
}

export class WorkerKmsPreflightError extends Error {
  readonly name = "WorkerKmsPreflightError"
  readonly reason: "invalid_key_version" | "round_trip_mismatch"

  constructor(reason: WorkerKmsPreflightError["reason"]) {
    super("Worker KMS preflight failed")
    this.reason = reason
  }
}

export async function runWorkerKmsPreflight(input: {
  readonly codec: KmsEnvelopeCodec
  readonly keyVersion: number
}): Promise<WorkerKmsPreflightResult> {
  if (!Number.isInteger(input.keyVersion) || input.keyVersion < 1) {
    throw new WorkerKmsPreflightError("invalid_key_version")
  }
  const envelope = await input.codec.seal(preflightPlaintext, input.keyVersion, preflightContext)
  const plaintext = await input.codec.unseal(envelope, preflightContext)
  if (plaintext !== preflightPlaintext) throw new WorkerKmsPreflightError("round_trip_mismatch")
  return { status: "passed", keyVersion: input.keyVersion }
}
