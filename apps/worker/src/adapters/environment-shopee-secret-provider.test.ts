import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { RUNTIME_POLICY_VERSION, RuntimeCapabilityDeniedError } from "../../../../packages/runtime-boundaries/src/runtime-boundaries.ts"
import { createEnvironmentShopeeSecretProvider } from "./environment-shopee-secret-provider.ts"

const secretCanary = "worker-secret-canary"

describe("worker-only Shopee secret provider adapter", () => {
  it("allows the worker role to read an explicitly requested secret", async () => {
    const provider = createEnvironmentShopeeSecretProvider({ SHOPEE_PARTNER_KEY: secretCanary })
    assert.equal(await provider.get("SHOPEE_PARTNER_KEY"), secretCanary)
  })

  it("denies web, migration, and readonly-support before environment access", async () => {
    const roles = ["web", "migration", "readonly-support"] as const
    for (const runtimeRole of roles) {
      let reads = 0
      const environment = new Proxy({ SHOPEE_PARTNER_KEY: secretCanary }, {
        get(target, property, receiver) {
          reads += 1
          return Reflect.get(target, property, receiver)
        },
      })
      const provider = createEnvironmentShopeeSecretProvider(environment, { runtimeRole })
      await assert.rejects(provider.get("SHOPEE_PARTNER_KEY"), RuntimeCapabilityDeniedError)
      assert.equal(reads, 0)
    }
  })

  it("denies a stale policy before environment access", async () => {
    let reads = 0
    const environment = new Proxy({ SHOPEE_PARTNER_KEY: secretCanary }, {
      get(target, property, receiver) {
        reads += 1
        return Reflect.get(target, property, receiver)
      },
    })
    const provider = createEnvironmentShopeeSecretProvider(environment, {
      runtimeRole: "worker",
      policyVersion: "phase0_v1" as typeof RUNTIME_POLICY_VERSION,
    })
    await assert.rejects(provider.get("SHOPEE_PARTNER_KEY"), RuntimeCapabilityDeniedError)
    assert.equal(reads, 0)
  })
})
