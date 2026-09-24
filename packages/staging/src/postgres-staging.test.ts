import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { OrganizationIdSchema, ShopIdSchema } from "../../identity/src/model.ts"
import { StagingFeatureFlagsSchema, StagingReconciliationSnapshotSchema } from "./model.ts"
import { FakeStagingPostgresExecutor } from "./postgres-staging.fake.ts"
import { PostgresStagingRepository } from "./postgres-staging.ts"

const organizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
const shopId = ShopIdSchema.parse("30000000-0000-4000-8000-000000000001")
const otherShopId = ShopIdSchema.parse("30000000-0000-4000-8000-000000000009")

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

function reconciliation(shop: typeof shopId, status: "clean" | "mismatch" | "unavailable") {
  return StagingReconciliationSnapshotSchema.parse({
    organizationId,
    shopId: shop,
    collectedAt: "2026-09-09T00:00:00.000Z",
    status,
    expectedDestinationCount: 0,
    observedDestinationCount: 0,
  })
}

describe("PostgreSQL staging persistence contract", () => {
  it("atomically saves and reads feature flags and reconciliation by organization and shop", async () => {
    // Given: a provider-free staging snapshot scoped to one organization and shop.
    const executor = new FakeStagingPostgresExecutor()
    const repository = new PostgresStagingRepository(executor)

    // When: the snapshot is persisted and then read through the repository.
    await repository.saveSnapshot({ featureFlags, reconciliation: reconciliation(shopId, "clean") })
    const loaded = await repository.readSnapshot({ organizationId, shopId })

    // Then: all flags, zero counts, timestamp, and scope survive the durable mapping.
    assert.deepEqual(loaded, { featureFlags, reconciliation: reconciliation(shopId, "clean") })
    assert.equal(executor.statementsFor("staging.snapshot.upsert_flags").length, 1)
    assert.equal(executor.statementsFor("staging.snapshot.upsert_reconciliation").length, 1)
  })

  it("does not cross-read a different shop in the same organization", async () => {
    // Given: one persisted shop-scoped snapshot.
    const executor = new FakeStagingPostgresExecutor()
    const repository = new PostgresStagingRepository(executor)
    await repository.saveSnapshot({ featureFlags, reconciliation: reconciliation(shopId, "mismatch") })

    // When: a reader requests a different shop under the same organization.
    const loaded = await repository.readSnapshot({ organizationId, shopId: otherShopId })

    // Then: the composite scope returns no state instead of leaking the first shop.
    assert.equal(loaded, null)
  })

  it("preserves a unavailable reconciliation state and capability unknown flag", async () => {
    // Given: an unavailable provider reconciliation with no destinations observed.
    const executor = new FakeStagingPostgresExecutor()
    const repository = new PostgresStagingRepository(executor)
    const input = { featureFlags, reconciliation: reconciliation(shopId, "unavailable") }

    // When: the snapshot is persisted and loaded.
    await repository.saveSnapshot(input)
    const loaded = await repository.readSnapshot({ organizationId, shopId })

    // Then: unavailable remains truthful and the unknown capability remains fail-closed data.
    assert.equal(loaded?.reconciliation.status, "unavailable")
    assert.equal(loaded?.reconciliation.observedDestinationCount, 0)
    assert.equal(loaded?.featureFlags.capabilityGates.officialProductWrite, "unknown")
  })

  it("keeps the migration composite foreign key and fail-closed flags explicit", () => {
    // Given: the staging persistence migration source.
    const migration = readFileSync(new URL("../../../db/migrations/0003_staging.sql", import.meta.url), "utf8")

    // When: the migration contract is inspected.
    // Then: shop state is organization-scoped and all capability dimensions are persisted.
    assert.match(migration, /PRIMARY KEY \(organization_id, shop_id\)/)
    assert.match(migration, /FOREIGN KEY \(organization_id, shop_id\)/)
    assert.match(migration, /official_product_write text NOT NULL CHECK/)
    assert.match(migration, /observed_destination_count integer NOT NULL CHECK/)
    assert.match(migration, /collected_at timestamptz NOT NULL/)
  })
})
