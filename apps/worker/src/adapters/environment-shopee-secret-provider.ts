import type {
  ShopeeSecretName,
  ShopeeSecretProvider,
} from "../../../../packages/integrations/src/shopee-secrets.ts"
import {
  requireRuntimeCapability,
  RUNTIME_POLICY_VERSION,
  type RuntimePolicyVersion,
  type RuntimeRole,
} from "../../../../packages/runtime-boundaries/src/runtime-boundaries.ts"

export function createEnvironmentShopeeSecretProvider(
  environment: NodeJS.ProcessEnv,
  options: { readonly runtimeRole?: RuntimeRole; readonly policyVersion?: RuntimePolicyVersion } = {},
): ShopeeSecretProvider {
  const runtimeRole = options.runtimeRole ?? "worker"
  const policyVersion = options.policyVersion ?? RUNTIME_POLICY_VERSION
  return {
    get: async (name: ShopeeSecretName) => {
      requireRuntimeCapability({ role: runtimeRole, capability: "secret_provider", policyVersion })
      return environment[name]
    },
  }
}
