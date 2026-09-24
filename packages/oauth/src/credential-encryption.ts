import { z } from "zod"
import {
  requireRuntimeCapability,
  type RuntimePolicyVersion,
  type RuntimeRole,
} from "../../runtime-boundaries/src/runtime-boundaries.ts"
import {
  CallbackCodeSchema,
  OAuthRefreshTokenSchema,
} from "./model.ts"
import {
  type EncryptedCredentialEnvelope,
  KmsEncryptionContextSchema,
  type KmsEncryptionContext,
  type KmsEnvelopeCodec,
  type KmsPlaintext,
} from "./durable-contracts.ts"

const EncryptedCredentialEnvelopeSchema = z.object({
  keyVersion: z.number().int().positive(),
  ciphertext: z.string().trim().min(1).max(16_384),
  algorithm: z.literal("kms-envelope-v1"),
}).strict().readonly()

export type KmsEnvelopeBackend = {
  readonly encrypt: (input: {
    readonly plaintext: KmsPlaintext
    readonly keyVersion: number
    readonly encryptionContext: KmsEncryptionContext
  }) => Promise<unknown>
  readonly decrypt: (input: {
    readonly envelope: EncryptedCredentialEnvelope
    readonly encryptionContext: KmsEncryptionContext
  }) => Promise<unknown>
}

export class KmsEnvelopeAccessError extends Error {
  readonly name = "KmsEnvelopeAccessError"
  readonly reason:
    | "seal_capability_denied"
    | "unseal_capability_denied"
    | "invalid_key_version"
    | "invalid_context"
    | "invalid_envelope"
    | "invalid_plaintext"
    | "backend_failure"

  constructor(reason: KmsEnvelopeAccessError["reason"]) {
    super("KMS envelope operation failed")
    this.reason = reason
  }
}

export function createRuntimeBoundKmsEnvelopeCodec(input: {
  readonly runtimeRole: RuntimeRole
  readonly policyVersion: RuntimePolicyVersion
  readonly backend: KmsEnvelopeBackend
}): KmsEnvelopeCodec {
  return {
    seal: async (plaintext, keyVersion, context) => {
      if (input.runtimeRole !== "web" && input.runtimeRole !== "worker") {
        throw new KmsEnvelopeAccessError("seal_capability_denied")
      }
      if (!Number.isInteger(keyVersion) || keyVersion < 1) {
        throw new KmsEnvelopeAccessError("invalid_key_version")
      }
      const parsedPlaintext = parsePlaintext(plaintext, context)
      if (!parsedPlaintext.success) throw new KmsEnvelopeAccessError("invalid_plaintext")
      const parsedContext = KmsEncryptionContextSchema.safeParse(context)
      if (!parsedContext.success) throw new KmsEnvelopeAccessError("invalid_context")
      try {
        requireRuntimeCapability({
          role: input.runtimeRole,
          capability: "kms_encrypt_callback_code",
          policyVersion: input.policyVersion,
        })
        const envelope = EncryptedCredentialEnvelopeSchema.safeParse(
          await input.backend.encrypt({
            plaintext: parsedPlaintext.data,
            keyVersion,
            encryptionContext: parsedContext.data,
          }),
        )
        if (!envelope.success) throw new KmsEnvelopeAccessError("invalid_envelope")
        return envelope.data
      } catch (error) {
        if (error instanceof KmsEnvelopeAccessError) throw error
        throw new KmsEnvelopeAccessError("backend_failure")
      }
    },
    unseal: async (envelope, context) => {
      try {
        requireRuntimeCapability({
          role: input.runtimeRole,
          capability: "kms_decrypt_credentials",
          policyVersion: input.policyVersion,
        })
      } catch {
        throw new KmsEnvelopeAccessError("unseal_capability_denied")
      }
      const parsedEnvelope = EncryptedCredentialEnvelopeSchema.safeParse(envelope)
      if (!parsedEnvelope.success) throw new KmsEnvelopeAccessError("invalid_envelope")
      const parsedContext = KmsEncryptionContextSchema.safeParse(context)
      if (!parsedContext.success) throw new KmsEnvelopeAccessError("invalid_context")
      try {
        const plaintext = parsePlaintext(await input.backend.decrypt({
          envelope: parsedEnvelope.data,
          encryptionContext: parsedContext.data,
        }), parsedContext.data)
        if (!plaintext.success) throw new KmsEnvelopeAccessError("invalid_plaintext")
        return plaintext.data
      } catch (error) {
        if (error instanceof KmsEnvelopeAccessError) throw error
        throw new KmsEnvelopeAccessError("backend_failure")
      }
    },
  }
}

function parsePlaintext(
  value: unknown,
  context: KmsEncryptionContext,
): { readonly success: true; readonly data: KmsPlaintext } | { readonly success: false } {
  switch (context.purpose) {
    case "oauth_callback_code":
      return CallbackCodeSchema.safeParse(value)
    case "oauth_refresh_token":
      return OAuthRefreshTokenSchema.safeParse(value)
    default:
      return assertNever(context)
  }
}

function assertNever(value: never): never {
  throw new TypeError(`Unhandled KMS encryption context: ${String(value)}`)
}
