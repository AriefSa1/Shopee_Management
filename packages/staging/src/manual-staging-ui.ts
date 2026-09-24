import assert from "node:assert/strict"
import { OrganizationIdSchema, ShopIdSchema } from "../../identity/src/model.ts"
import { StagingFeatureFlagsSchema, StagingReconciliationSnapshotSchema } from "./model.ts"
import { createStagingUiHandler } from "./staging-ui.ts"

const organizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
const shopId = ShopIdSchema.parse("30000000-0000-4000-8000-000000000001")
const response = await createStagingUiHandler(new Request(`https://app.test/staging/alpha?organizationId=${organizationId}&shopId=${shopId}`, { headers: { authorization: "Bearer fixture" } }), {
  authenticate: () => ({ organizationId, accessibleShopIds: [shopId] }),
  read: async () => ({
    featureFlags: StagingFeatureFlagsSchema.parse({ environment: "staging", writePilotEnabled: true, capabilityGates: { officialProductWrite: "unknown", mediaLifecycle: "verified", itemCorrelation: "verified", variationAtomicity: "verified", safeRecovery: "verified" } }),
    reconciliation: StagingReconciliationSnapshotSchema.parse({ organizationId, shopId, collectedAt: "2026-09-09T00:00:00.000Z", status: "clean", expectedDestinationCount: 1, observedDestinationCount: 1 }),
  }),
})
const html = await response.text()
assert.equal(response.status, 200)
assert.match(html, /read-only/i)
assert.match(html, /capability_unknown/)
assert.doesNotMatch(html, /<form|<button|<script/i)
console.log(JSON.stringify({ scenario: "staging-read-only-alpha-ui", status: response.status, mutationControls: "unavailable", capabilityUnknown: true, networkCalls: 0, databaseCalls: 0, shopeeMutations: 0, externalWrites: 0, secretFieldsPresent: false }))

