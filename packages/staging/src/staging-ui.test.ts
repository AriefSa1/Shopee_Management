import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { OrganizationIdSchema, ShopIdSchema } from "../../identity/src/model.ts"
import { StagingFeatureFlagsSchema, StagingReconciliationSnapshotSchema } from "./model.ts"
import { createStagingUiHandler } from "./staging-ui.ts"
import type { StagingApiDependencies } from "./staging-api.ts"

const organizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
const shopId = ShopIdSchema.parse("30000000-0000-4000-8000-000000000001")
const featureFlags = StagingFeatureFlagsSchema.parse({ environment: "staging", writePilotEnabled: true, capabilityGates: { officialProductWrite: "unknown", mediaLifecycle: "verified", itemCorrelation: "verified", variationAtomicity: "verified", safeRecovery: "verified" } })
const reconciliation = StagingReconciliationSnapshotSchema.parse({ organizationId, shopId, collectedAt: "2026-09-09T00:00:00.000Z", status: "mismatch", expectedDestinationCount: 2, observedDestinationCount: 1 })

function dependencies(): StagingApiDependencies {
  return { authenticate: () => ({ organizationId, accessibleShopIds: [shopId] }), read: async () => ({ featureFlags, reconciliation }) }
}

describe("staging read-only alpha UI boundary", () => {
  it("renders fail-closed gate, hold, rollback, and blocked operations without mutation controls", async () => {
    const response = await createStagingUiHandler(new Request(`https://app.test/staging/alpha?organizationId=${organizationId}&shopId=${shopId}`, { headers: { authorization: "Bearer fixture" } }), dependencies())
    const html = await response.text()
    assert.equal(response.status, 200)
    assert.match(html, /Staging Read-only Alpha/)
    assert.match(html, /capability_unknown/)
    assert.match(html, /disable_write_dispatch/)
    assert.match(html, /product_create/)
    assert.match(html, /Mutation controls are unavailable/)
    assert.doesNotMatch(html, /<form|<button|<script/i)
  })

  it("renders escaped safe error content and preserves the API status", async () => {
    const response = await createStagingUiHandler(new Request(`https://app.test/staging/alpha?organizationId=${organizationId}&shopId=${shopId}`, { headers: { authorization: "Bearer fixture" } }), { authenticate: () => null, read: async () => ({ featureFlags, reconciliation }) })
    const html = await response.text()
    assert.equal(response.status, 401)
    assert.match(html, /authentication_required/)
    assert.match(response.headers.get("content-type") ?? "", /text\/html/)
  })
})

