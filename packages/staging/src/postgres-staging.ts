import { OrganizationIdSchema, ShopIdSchema, type OrganizationId, type ShopId } from "../../identity/src/model.ts"
import {
  StagingFeatureFlagsSchema,
  StagingReconciliationSnapshotSchema,
  type StagingFeatureFlags,
  type StagingReconciliationSnapshot,
} from "./model.ts"
import type { PostgresExecutor, SqlRow } from "../../delivery/src/postgres-delivery.ts"

export type StagingSnapshot = {
  readonly featureFlags: StagingFeatureFlags
  readonly reconciliation: StagingReconciliationSnapshot
}

export type StagingSnapshotInput = StagingSnapshot

export type StagingScope = {
  readonly organizationId: OrganizationId
  readonly shopId: ShopId
}

export class PostgresStagingRepository {
  private readonly executor: PostgresExecutor

  constructor(executor: PostgresExecutor) {
    this.executor = executor
  }

  saveSnapshot(input: StagingSnapshotInput): Promise<void> {
    return this.executor.transaction(async (tx) => {
      const flags = StagingFeatureFlagsSchema.parse(input.featureFlags)
      const reconciliation = StagingReconciliationSnapshotSchema.parse(input.reconciliation)
      await tx.query({
        name: "staging.snapshot.upsert_flags",
        text: `INSERT INTO staging_feature_flags (
          organization_id, shop_id, environment, write_pilot_enabled,
          official_product_write, media_lifecycle, item_correlation,
          variation_atomicity, safe_recovery, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (organization_id, shop_id) DO UPDATE SET
          environment = EXCLUDED.environment,
          write_pilot_enabled = EXCLUDED.write_pilot_enabled,
          official_product_write = EXCLUDED.official_product_write,
          media_lifecycle = EXCLUDED.media_lifecycle,
          item_correlation = EXCLUDED.item_correlation,
          variation_atomicity = EXCLUDED.variation_atomicity,
          safe_recovery = EXCLUDED.safe_recovery,
          updated_at = EXCLUDED.updated_at`,
        params: [
          reconciliation.organizationId,
          reconciliation.shopId,
          flags.environment,
          flags.writePilotEnabled,
          flags.capabilityGates.officialProductWrite,
          flags.capabilityGates.mediaLifecycle,
          flags.capabilityGates.itemCorrelation,
          flags.capabilityGates.variationAtomicity,
          flags.capabilityGates.safeRecovery,
          reconciliation.collectedAt,
        ],
      })
      await tx.query({
        name: "staging.snapshot.upsert_reconciliation",
        text: `INSERT INTO staging_reconciliation_snapshots (
          organization_id, shop_id, collected_at, status,
          expected_destination_count, observed_destination_count
        ) VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (organization_id, shop_id) DO UPDATE SET
          collected_at = EXCLUDED.collected_at,
          status = EXCLUDED.status,
          expected_destination_count = EXCLUDED.expected_destination_count,
          observed_destination_count = EXCLUDED.observed_destination_count`,
        params: [
          reconciliation.organizationId,
          reconciliation.shopId,
          reconciliation.collectedAt,
          reconciliation.status,
          reconciliation.expectedDestinationCount,
          reconciliation.observedDestinationCount,
        ],
      })
    })
  }

  async readSnapshot(scope: StagingScope): Promise<StagingSnapshot | null> {
    const rows = await this.executor.query({
      name: "staging.snapshot.read",
      text: `SELECT f.organization_id, f.shop_id, f.environment, f.write_pilot_enabled,
        f.official_product_write, f.media_lifecycle, f.item_correlation,
        f.variation_atomicity, f.safe_recovery, r.collected_at, r.status,
        r.expected_destination_count, r.observed_destination_count
      FROM staging_feature_flags AS f
      INNER JOIN staging_reconciliation_snapshots AS r
        ON r.organization_id = f.organization_id AND r.shop_id = f.shop_id
      WHERE f.organization_id = $1 AND f.shop_id = $2`,
      params: [scope.organizationId, scope.shopId],
    })
    const row = rows[0]
    return row === undefined ? null : mapSnapshot(row)
  }
}

function requiredString(row: SqlRow, key: string): string {
  const value = row[key]
  if (typeof value !== "string") throw new Error(`Invalid staging row field: ${key}`)
  return value
}

function requiredBoolean(row: SqlRow, key: string): boolean {
  const value = row[key]
  if (typeof value !== "boolean") throw new Error(`Invalid staging row field: ${key}`)
  return value
}

function requiredNumber(row: SqlRow, key: string): number {
  const value = row[key]
  if (typeof value !== "number") throw new Error(`Invalid staging row field: ${key}`)
  return value
}

function mapSnapshot(row: SqlRow): StagingSnapshot {
  const organizationId = OrganizationIdSchema.parse(requiredString(row, "organization_id"))
  const shopId = ShopIdSchema.parse(requiredString(row, "shop_id"))
  return {
    featureFlags: StagingFeatureFlagsSchema.parse({
      environment: requiredString(row, "environment"),
      writePilotEnabled: requiredBoolean(row, "write_pilot_enabled"),
      capabilityGates: {
        officialProductWrite: requiredString(row, "official_product_write"),
        mediaLifecycle: requiredString(row, "media_lifecycle"),
        itemCorrelation: requiredString(row, "item_correlation"),
        variationAtomicity: requiredString(row, "variation_atomicity"),
        safeRecovery: requiredString(row, "safe_recovery"),
      },
    }),
    reconciliation: StagingReconciliationSnapshotSchema.parse({
      organizationId,
      shopId,
      collectedAt: requiredString(row, "collected_at"),
      status: requiredString(row, "status"),
      expectedDestinationCount: requiredNumber(row, "expected_destination_count"),
      observedDestinationCount: requiredNumber(row, "observed_destination_count"),
    }),
  }
}
