import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import type { OrganizationId, ShopId } from "../../identity/src/model.ts"
import {
  OrganizationIdSchema,
  ShopIdSchema,
  StagingFeatureFlagsSchema,
  StagingReconciliationSnapshotSchema,
} from "./index.ts"
import { FakeStagingPostgresExecutor } from "./postgres-staging.fake.ts"
import { PostgresStagingRepository } from "./postgres-staging.ts"

const organizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
const otherOrganizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000009")
const shopId = ShopIdSchema.parse("30000000-0000-4000-8000-000000000001")
const otherShopId = ShopIdSchema.parse("30000000-0000-4000-8000-000000000009")
const collectedAt = "2026-09-09T00:00:00.000Z"

const featureFlags = StagingFeatureFlagsSchema.parse({
  environment: "staging",
  writePilotEnabled: false,
  capabilityGates: {
    officialProductWrite: "unknown",
    mediaLifecycle: "unknown",
    itemCorrelation: "unknown",
    variationAtomicity: "unknown",
    safeRecovery: "unknown",
  },
})

function snapshot(scope: { readonly organizationId: OrganizationId; readonly shopId: ShopId }, status: "clean" | "unavailable") {
  return StagingReconciliationSnapshotSchema.parse({
    ...scope,
    collectedAt,
    status,
    expectedDestinationCount: 0,
    observedDestinationCount: 0,
  })
}

const executor = new FakeStagingPostgresExecutor()
const repository = new PostgresStagingRepository(executor)
await repository.saveSnapshot({ featureFlags, reconciliation: snapshot({ organizationId, shopId }, "clean") })
const loaded = await repository.readSnapshot({ organizationId, shopId })
assert.deepEqual(loaded, { featureFlags, reconciliation: snapshot({ organizationId, shopId }, "clean") })
assert.equal(loaded?.reconciliation.expectedDestinationCount, 0)
assert.equal(loaded?.reconciliation.observedDestinationCount, 0)

await repository.saveSnapshot({
  featureFlags,
  reconciliation: snapshot({ organizationId, shopId: otherShopId }, "unavailable"),
})
const otherShop = await repository.readSnapshot({ organizationId, shopId: otherShopId })
assert.equal(otherShop?.reconciliation.status, "unavailable")
assert.equal(otherShop?.reconciliation.observedDestinationCount, 0)
await repository.saveSnapshot({
  featureFlags,
  reconciliation: snapshot({ organizationId: otherOrganizationId, shopId }, "clean"),
})
assert.equal((await repository.readSnapshot({ organizationId: otherOrganizationId, shopId }))?.reconciliation.organizationId, otherOrganizationId)
assert.equal((await repository.readSnapshot({ organizationId, shopId: otherShopId }))?.reconciliation.organizationId, organizationId)

const migration = readFileSync(new URL("../../../db/migrations/0003_staging.sql", import.meta.url), "utf8")
assert.match(migration, /PRIMARY KEY \(organization_id, shop_id\)/)
assert.match(migration, /FOREIGN KEY \(organization_id, shop_id\)/)
assert.match(migration, /official_product_write text NOT NULL CHECK/)
assert.match(migration, /observed_destination_count integer NOT NULL CHECK/)
assert.match(migration, /CHECK \(status <> 'clean' OR expected_destination_count = observed_destination_count\)/)

const result = {
  scenario: "postgres-staging-persistence-contract",
  executor: "deterministic-fake-postgres-executor",
  saveRead: "passed",
  compositeScopeIsolation: "passed",
  numericZeroPreserved: "passed",
  unavailableStatePreserved: "passed",
  migrationContract: "passed",
  statements: executor.statements.length,
  externalEffects: {
    networkCalls: 0,
    databaseCalls: 0,
    shopeeMutations: 0,
    kmsCalls: 0,
    externalWrites: 0,
  },
  livePostgres: "not_run",
  secretFieldsPresent: false,
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
