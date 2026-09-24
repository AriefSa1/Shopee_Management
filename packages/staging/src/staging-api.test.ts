import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { OrganizationIdSchema, ShopIdSchema } from "../../identity/src/model.ts"
import { StagingFeatureFlagsSchema, StagingReconciliationSnapshotSchema } from "./index.ts"
import { createStagingApiHandler, type StagingApiDependencies } from "./staging-api.ts"

const organizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
const shopId = ShopIdSchema.parse("30000000-0000-4000-8000-000000000001")
const featureFlags = StagingFeatureFlagsSchema.parse({
  environment: "staging",
  writePilotEnabled: true,
  capabilityGates: {
    officialProductWrite: "unknown",
    mediaLifecycle: "verified",
    itemCorrelation: "verified",
    variationAtomicity: "verified",
    safeRecovery: "verified",
  },
})
const reconciliation = StagingReconciliationSnapshotSchema.parse({
  organizationId,
  shopId,
  collectedAt: "2026-09-09T00:00:00.000Z",
  status: "mismatch",
  expectedDestinationCount: 2,
  observedDestinationCount: 1,
})

function dependencies(read: StagingApiDependencies["read"] = async () => ({ featureFlags, reconciliation })): StagingApiDependencies {
  return { authenticate: () => ({ organizationId, accessibleShopIds: [shopId] }), read }
}

describe("staging read-only API boundary", () => {
  it("rejects unauthenticated requests before reading staging state", async () => {
    let reads = 0
    const response = await createStagingApiHandler(
      new Request(`https://app.test/api/staging/alpha?organizationId=${organizationId}&shopId=${shopId}`),
      { authenticate: () => null, read: async () => { reads += 1; return { featureFlags, reconciliation } } },
    )

    assert.equal(response.status, 401)
    assert.deepEqual(await response.json(), { error: { code: "authentication_required" } })
    assert.equal(reads, 0)
  })

  it("returns a fail-closed workflow for an authorized organization and shop", async () => {
    const response = await createStagingApiHandler(
      new Request(`https://app.test/api/staging/alpha?organizationId=${organizationId}&shopId=${shopId}`, { headers: { authorization: "Bearer test-token" } }),
      dependencies(),
    )

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      data: {
        organizationId,
        shopId,
        environment: "staging",
        writeGate: { kind: "write_disabled", reason: "capability_unknown" },
        mutationPolicy: "blocked",
        holdControl: { kind: "hold_active", reason: "write_gate_disabled" },
        rollbackControl: { kind: "rollback_ready", action: "disable_write_dispatch" },
        allowedOperations: ["catalog_read", "analytics_read", "copy_preview", "reconciliation_review"],
        blockedOperations: ["media_upload", "product_create", "variation_create"],
      },
    })
  })

  it("denies organization and shop scope violations without reading state", async () => {
    let reads = 0
    const deps = dependencies(async () => { reads += 1; return { featureFlags, reconciliation } })
    const foreignOrganization = "10000000-0000-4000-8000-000000000009"
    const foreignShop = "30000000-0000-4000-8000-000000000009"

    const organizationResponse = await createStagingApiHandler(
      new Request(`https://app.test/api/staging/alpha?organizationId=${foreignOrganization}&shopId=${shopId}`, { headers: { authorization: "Bearer token" } }), deps,
    )
    const shopResponse = await createStagingApiHandler(
      new Request(`https://app.test/api/staging/alpha?organizationId=${organizationId}&shopId=${foreignShop}`, { headers: { authorization: "Bearer token" } }), deps,
    )

    assert.equal(organizationResponse.status, 403)
    assert.deepEqual(await organizationResponse.json(), { error: { code: "organization_mismatch" } })
    assert.equal(shopResponse.status, 403)
    assert.deepEqual(await shopResponse.json(), { error: { code: "shop_not_accessible" } })
    assert.equal(reads, 0)
  })

  it("maps state-reader failures to a safe retryable response", async () => {
    const response = await createStagingApiHandler(
      new Request(`https://app.test/api/staging/alpha?organizationId=${organizationId}&shopId=${shopId}`, { headers: { authorization: "Bearer token" } }),
      dependencies(async () => { throw new Error("provider details must not escape") }),
    )

    assert.equal(response.status, 502)
    assert.deepEqual(await response.json(), { error: { code: "staging_state_unavailable", retryable: true } })
  })

  it("rejects reconciliation state for a different shop", async () => {
    const foreignShop = ShopIdSchema.parse("30000000-0000-4000-8000-000000000009")
    const response = await createStagingApiHandler(
      new Request(`https://app.test/api/staging/alpha?organizationId=${organizationId}&shopId=${shopId}`, { headers: { authorization: "Bearer token" } }),
      dependencies(async () => ({
        featureFlags,
        reconciliation: { ...reconciliation, shopId: foreignShop },
      })),
    )

    assert.equal(response.status, 403)
    assert.deepEqual(await response.json(), { error: { code: "staging_scope_mismatch" } })
  })
})
