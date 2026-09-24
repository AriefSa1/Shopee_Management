import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { describe, it } from "node:test"
import { scanSecretExposure } from "./secret-scan.ts"

const workspaceRoot = resolve(import.meta.dirname, "../../..")

describe("secret exposure scan contract", () => {
  it("reports only safe file/rule metadata for forbidden secret access", () => {
    const result = scanSecretExposure([
      {
        path: "fixture/unsafe.ts",
        source: "const key = process.env.SHOPEE_PARTNER_KEY; console.log(access_token, key)",
      },
    ])

    assert.deepEqual(result, [
      { path: "fixture/unsafe.ts", rule: "runtime_env_access" },
      { path: "fixture/unsafe.ts", rule: "credential_identifier" },
    ])
    assert.equal(JSON.stringify(result).includes("SHOPEE_PARTNER_KEY"), false)
  })

  it("accepts a provider-free package source with no secret access", () => {
    const result = scanSecretExposure([
      { path: "fixture/safe.ts", source: "return { code: 'untrusted_error' }" },
    ])

    assert.deepEqual(result, [])
  })

  it("keeps foundational package sources free of runtime environment access", async () => {
    const sourcePaths = [
      "packages/config/src/runtime-config.ts",
      "packages/observability/src/safe-telemetry.ts",
      "packages/runtime-boundaries/src/runtime-boundaries.ts",
    ]
    const result = scanSecretExposure(
      await Promise.all(
        sourcePaths.map(async (path) => ({ path, source: await readFile(resolve(workspaceRoot, path), "utf8") })),
      ),
    )

    assert.deepEqual(result, [])
  })
})
