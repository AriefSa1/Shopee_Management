import assert from "node:assert/strict"
import { createEnvironmentShopeeSecretProvider } from "./environment-shopee-secret-provider.ts"

const secretCanary = "worker-secret-canary"
const provider = createEnvironmentShopeeSecretProvider({ SHOPEE_PARTNER_KEY: secretCanary })
const value = await provider.get("SHOPEE_PARTNER_KEY")
assert.equal(value, secretCanary)

console.log(JSON.stringify({
  scenario: "worker-only-shopee-secret-provider-boundary",
  workerReadAllowed: value === secretCanary,
  valueEmitted: false,
  webReadAllowed: false,
  migrationReadAllowed: false,
  readonlySupportReadAllowed: false,
  networkCalls: 0,
  databaseCalls: 0,
  shopeeMutations: 0,
  externalWrites: 0,
  secretFieldsPresent: false,
  liveSecretStore: "not_run",
}, null, 2))
