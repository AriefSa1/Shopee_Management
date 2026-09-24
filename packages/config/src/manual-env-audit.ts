import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const root = new URL("../../../", import.meta.url)
const envText = readFileSync(new URL(".env", root), "utf8")
const gitignoreText = readFileSync(new URL(".gitignore", root), "utf8")
const keys = new Map<string, string>()
for (const line of envText.split(/\r?\n/u)) {
  const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/u.exec(line)
  if (match !== null) keys.set(match[1] ?? "", match[2] ?? "")
}

const partnerFields = ["SHOPEE_PARTNER_ID", "SHOPEE_PARTNER_KEY"]
const tokenFields = ["SHOPEE_ACCESS_TOKEN", "SHOPEE_REFRESH_TOKEN"]
const partnerFieldsPresent = partnerFields.filter((field) => (keys.get(field) ?? "").trim().length > 0)
const tokenFieldsPresent = tokenFields.filter((field) => (keys.get(field) ?? "").trim().length > 0)
const gitignoreProtectsEnv = /(?:^|\r?\n)\.env\r?\n/u.test(gitignoreText) && /!\.env\.example/u.test(gitignoreText)

assert.equal(partnerFieldsPresent.length, partnerFields.length)
assert.equal(gitignoreProtectsEnv, true)
if (partnerFieldsPresent.length > 1) assert.equal(envText.includes(partnerFieldsPresent.join("=")), false)
if (tokenFieldsPresent.length > 1) assert.equal(envText.includes(tokenFieldsPresent.join("=")), false)

console.log(JSON.stringify({
  scenario: "phase1-env-metadata-audit",
  appEnvironment: keys.get("APP_ENV")?.trim() || "unset",
  databaseConfigured: (keys.get("DATABASE_URL") ?? "").trim().length > 0,
  partnerFieldsPresent,
  tokenFieldsPresent,
  tokenEnvRisk: tokenFieldsPresent.length > 0 ? "remove-before-production-and-use-kms-subject-storage" : "none_detected",
  gitignoreProtectsEnv,
  secretValuesEmitted: false,
  networkCalls: 0,
  databaseCalls: 0,
  shopeeMutations: 0,
  externalWrites: 0,
}))
