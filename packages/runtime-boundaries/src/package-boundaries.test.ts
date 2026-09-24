import assert from "node:assert/strict"
import { readFile, readdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, it } from "node:test"

const SOURCE_FILE_PATTERN = /\.ts$/
const TEST_FILE_PATTERN = /\.test\.ts$/
const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")

async function listTypeScriptSources(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = resolve(directory, entry.name)
      if (entry.isDirectory()) return listTypeScriptSources(entryPath)
      return SOURCE_FILE_PATTERN.test(entry.name) && !TEST_FILE_PATTERN.test(entry.name) ? [entryPath] : []
    }),
  )
  return files.flat()
}

async function findImportsReferencing(
  sourceRoot: string,
  moduleFragment: string,
): Promise<readonly string[]> {
  const sourceFiles = await listTypeScriptSources(sourceRoot)
  const matching = await Promise.all(
    sourceFiles.map(async (sourceFile) => {
      const source = await readFile(sourceFile, "utf8")
      return source.includes(moduleFragment) ? [sourceFile] : []
    }),
  )
  return matching.flat()
}

describe("package boundary contracts", () => {
  it("keeps the worker-only secret-provider interface out of non-worker applications", async () => {
    // Given: every production source file in the apps and packages roots.
    const references = [
      ...(await findImportsReferencing(resolve(workspaceRoot, "apps"), "shopee-secrets.ts")),
      ...(await findImportsReferencing(resolve(workspaceRoot, "packages"), "shopee-secrets.ts")),
      ...(await findImportsReferencing(resolve(workspaceRoot, "apps"), "worker-secret-provider.ts")),
      ...(await findImportsReferencing(resolve(workspaceRoot, "packages"), "worker-secret-provider.ts")),
    ]

    // When: each secret-provider reference is checked against its allowed package boundary.
    const violations = references.filter(
      (sourceFile) =>
        !sourceFile.includes("apps\\worker\\") &&
        !sourceFile.includes("packages\\integrations\\src\\shopee-secrets.ts") &&
        !sourceFile.includes("packages\\runtime-boundaries\\src\\worker-secret-provider.ts"),
    )

    // Then: only the worker runtime and the interface declarations may reference a secret provider.
    assert.deepEqual(violations, [])
  })

  it("keeps observability and runtime boundaries independent of applications and Shopee adapters", async () => {
    // Given: the two foundation-package source roots.
    const sourceRoots = [
      resolve(workspaceRoot, "packages", "observability", "src"),
      resolve(workspaceRoot, "packages", "runtime-boundaries", "src"),
    ]

    // When: production files are scanned for prohibited dependency directions.
    const prohibitedReferences = (
      await Promise.all(
        sourceRoots.map(async (sourceRoot) => {
          const sourceFiles = await listTypeScriptSources(sourceRoot)
          return Promise.all(
            sourceFiles.map(async (sourceFile) => {
              const source = await readFile(sourceFile, "utf8")
              return source.includes("apps/") || source.includes("integrations/") ? [sourceFile] : []
            }),
          )
        }),
      )
    )
      .flat(2)
      .sort()

    // Then: foundational safety primitives do not depend on a runtime application or Shopee adapter.
    assert.deepEqual(prohibitedReferences, [])
  })

  it("keeps OAuth exchange execution out of the web runtime and secret-provider imports out of OAuth contracts", async () => {
    const webOAuthExchangeImports = await findImportsReferencing(
      resolve(workspaceRoot, "apps", "web"),
      "worker-exchange.ts",
    )
    const oauthSecretProviderImports = await findImportsReferencing(
      resolve(workspaceRoot, "packages", "oauth", "src"),
      "worker-secret-provider.ts",
    )

    assert.deepEqual(webOAuthExchangeImports, [])
    assert.deepEqual(oauthSecretProviderImports, [])
  })
})
