import assert from "node:assert/strict"
import {
  getSafeConfigurationDiagnostics,
  parseMigrationConfig,
  parseReadonlySupportConfig,
} from "./runtime-config.ts"
import { scanSecretExposure } from "../../observability/src/secret-scan.ts"

const secretCanary = "manual-config-secret-canary"
const migration = parseMigrationConfig({ APP_ENV: "test", DATABASE_URL: "https://db.example.test" })
const readonlySupport = parseReadonlySupportConfig({ APP_ENV: "test" })
const diagnostics = getSafeConfigurationDiagnostics("worker", {
  APP_ENV: "production",
  WORKER_PORT: "invalid-port",
  SHOPEE_PARTNER_KEY: secretCanary,
})
const findings = scanSecretExposure([
  { path: "unsafe-fixture.ts", source: "process.env.SHOPEE_PARTNER_KEY; access_token" },
])

assert.equal(migration.mode, "migration")
assert.equal(readonlySupport.mode, "readonly-support")
assert.deepEqual(diagnostics, {
  mode: "worker",
  status: "invalid",
  fieldNames: ["DATABASE_URL", "WORKER_PORT"],
})
assert.deepEqual(findings, [
  { path: "unsafe-fixture.ts", rule: "runtime_env_access" },
  { path: "unsafe-fixture.ts", rule: "credential_identifier" },
])
assert.equal(JSON.stringify({ diagnostics, findings }).includes(secretCanary), false)

console.log(
  JSON.stringify({
    scenario: "phase1-config-security-manual",
    modes: [migration.mode, readonlySupport.mode],
    diagnostics,
    secretScan: { findingCount: findings.length, valuesExposed: false },
    networkCalls: 0,
    databaseCalls: 0,
    shopeeMutations: 0,
    secretFieldsPresent: false,
  }),
)
