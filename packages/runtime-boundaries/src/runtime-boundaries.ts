export const RUNTIME_ROLES = ["web", "worker", "migration", "readonly-support"] as const
export const RUNTIME_CAPABILITIES = [
  "safe_telemetry",
  "oauth_state",
  "kms_encrypt_callback_code",
  "secret_provider",
  "kms_decrypt_credentials",
  "shopee_call",
  "database_ddl",
  "safe_projection",
] as const
export const RUNTIME_POLICY_VERSION = "phase1_v1" as const

export type RuntimeRole = (typeof RUNTIME_ROLES)[number]
export type RuntimeCapability = (typeof RUNTIME_CAPABILITIES)[number]
export type RuntimePolicyVersion = typeof RUNTIME_POLICY_VERSION

export type RuntimeCapabilityRequest = {
  readonly role: RuntimeRole
  readonly capability: RuntimeCapability
  readonly policyVersion: string
}

export type RuntimeCapabilityDecision =
  | {
      readonly allowed: true
      readonly role: RuntimeRole
      readonly capability: RuntimeCapability
    }
  | {
      readonly allowed: false
      readonly reason: "policy_version_mismatch" | "capability_denied"
      readonly role: RuntimeRole
      readonly capability: RuntimeCapability
    }

const ALLOWED_CAPABILITIES = {
  web: ["safe_telemetry", "oauth_state", "kms_encrypt_callback_code"],
  worker: [
    "safe_telemetry",
    "secret_provider",
    "kms_encrypt_callback_code",
    "kms_decrypt_credentials",
    "shopee_call",
  ],
  migration: ["database_ddl"],
  "readonly-support": ["safe_telemetry", "safe_projection"],
} as const satisfies Readonly<Record<RuntimeRole, readonly RuntimeCapability[]>>

export class RuntimeCapabilityDeniedError extends Error {
  readonly name = "RuntimeCapabilityDeniedError"
  readonly role: RuntimeRole
  readonly capability: RuntimeCapability
  readonly reason: "policy_version_mismatch" | "capability_denied"

  constructor(decision: Extract<RuntimeCapabilityDecision, { readonly allowed: false }>) {
    super("Runtime capability denied")
    this.role = decision.role
    this.capability = decision.capability
    this.reason = decision.reason
  }
}

export function evaluateRuntimeCapability(
  request: RuntimeCapabilityRequest,
): RuntimeCapabilityDecision {
  if (request.policyVersion !== RUNTIME_POLICY_VERSION) {
    return {
      allowed: false,
      reason: "policy_version_mismatch",
      role: request.role,
      capability: request.capability,
    }
  }

  const allowed = ALLOWED_CAPABILITIES[request.role].some(
    (capability) => capability === request.capability,
  )
  return allowed
    ? { allowed: true, role: request.role, capability: request.capability }
    : {
        allowed: false,
        reason: "capability_denied",
        role: request.role,
        capability: request.capability,
      }
}

export function requireRuntimeCapability(request: RuntimeCapabilityRequest): void {
  const decision = evaluateRuntimeCapability(request)
  if (!decision.allowed) throw new RuntimeCapabilityDeniedError(decision)
}
