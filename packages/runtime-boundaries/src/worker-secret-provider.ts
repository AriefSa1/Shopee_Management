import {
  requireRuntimeCapability,
  type RuntimePolicyVersion,
  type RuntimeRole,
} from "./runtime-boundaries.ts"

export const WORKER_SECRET_NAMES = [
  "partner_application_key",
  "oauth_callback_code",
  "credential_subject_envelope",
] as const

export type WorkerSecretName = (typeof WORKER_SECRET_NAMES)[number]

export interface WorkerSecretProvider {
  get(name: WorkerSecretName): Promise<string | undefined>
}

export function requireWorkerSecretProviderAccess(
  role: RuntimeRole,
  policyVersion: RuntimePolicyVersion,
): void {
  requireRuntimeCapability({ role, capability: "secret_provider", policyVersion })
}
