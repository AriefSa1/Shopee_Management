import { z } from "zod"
import { OrganizationIdSchema, ShopIdSchema, CopyIntentIdSchema, CopyPreviewHashSchema, CopySourceSnapshotIdSchema, CopyRequirementSnapshotIdSchema, type CopyIntent, type CopyPreview } from "./model.ts"
import type { OrganizationId, ShopId } from "../../identity/src/model.ts"
import type { PostgresExecutor, SqlRow } from "../../delivery/src/postgres-delivery.ts"

export type CopyPreviewPersistenceRecord = { readonly intent: CopyIntent; readonly preview: CopyPreview }
export type CopyPreviewScope = { readonly organizationId: OrganizationId; readonly destinationShopId: ShopId }

export class CopyPreviewPersistenceError extends Error {
  readonly name = "CopyPreviewPersistenceError"
  readonly code: "scope_mismatch" | "invalid_row"
  constructor(code: CopyPreviewPersistenceError["code"]) { super(`Copy preview persistence rejected the request: ${code}`); this.code = code }
}

export class PostgresCopyPreviewRepository {
  private readonly executor: PostgresExecutor
  constructor(executor: PostgresExecutor) { this.executor = executor }
  save(record: CopyPreviewPersistenceRecord): Promise<void> {
    return this.executor.transaction(async (tx) => {
      const intent = record.intent
      const preview = record.preview
      if (intent.organizationId !== preview.organizationId || intent.destinationShopId !== preview.destinationShopId || intent.activePreviewHash !== preview.previewHash) throw new CopyPreviewPersistenceError("scope_mismatch")
      const previewJson = preview.kind === "valid" ? { attributes: preview.attributes } : { errors: preview.errors }
      await tx.query({ name: "copy.preview.insert", text: `INSERT INTO copy_previews (organization_id, preview_hash, source_snapshot_id, requirement_snapshot_id, destination_shop_id, kind, title, description, category_id, attributes, errors) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, params: [preview.organizationId, preview.previewHash, preview.sourceSnapshotId, preview.requirementSnapshotId, preview.destinationShopId, preview.kind, preview.kind === "valid" ? preview.title : null, preview.kind === "valid" ? preview.description : null, preview.kind === "valid" ? preview.categoryId : null, preview.kind === "valid" ? JSON.stringify(previewJson.attributes) : null, preview.kind === "invalid" ? JSON.stringify(previewJson.errors) : null] })
      await tx.query({ name: "copy.intent.insert", text: `INSERT INTO copy_intents (organization_id, copy_intent_id, source_snapshot_id, destination_shop_id, active_preview_hash, command_version, serialization_generation) VALUES ($1,$2,$3,$4,$5,$6,$7)`, params: [intent.organizationId, intent.copyIntentId, intent.sourceSnapshotId, intent.destinationShopId, intent.activePreviewHash, intent.commandVersion, intent.serializationGeneration] })
    })
  }
  async read(scope: CopyPreviewScope, intentId: string): Promise<CopyPreviewPersistenceRecord | null> {
    const id = CopyIntentIdSchema.parse(intentId)
    const rows = await this.executor.query({ name: "copy.intent.read", text: `SELECT i.organization_id, i.copy_intent_id, i.source_snapshot_id, i.destination_shop_id, i.active_preview_hash, i.command_version, i.serialization_generation, p.requirement_snapshot_id, p.kind, p.title, p.description, p.category_id, p.attributes, p.errors FROM copy_intents i JOIN copy_previews p ON p.organization_id = i.organization_id AND p.destination_shop_id = i.destination_shop_id AND p.preview_hash = i.active_preview_hash WHERE i.organization_id = $1 AND i.destination_shop_id = $2 AND i.copy_intent_id = $3`, params: [scope.organizationId, scope.destinationShopId, id] })
    const first = rows[0]
    if (first === undefined) return null
    return mapRecord(first)
  }
}

function requiredString(row: SqlRow, key: string): string { const value = row[key]; if (typeof value !== "string") throw new CopyPreviewPersistenceError("invalid_row"); return value }
function requiredNumber(row: SqlRow, key: string): number { const value = row[key]; if (typeof value !== "number" || !Number.isInteger(value) || value < 1) throw new CopyPreviewPersistenceError("invalid_row"); return value }
function mapRecord(row: SqlRow): CopyPreviewPersistenceRecord {
  const organizationId = OrganizationIdSchema.parse(requiredString(row, "organization_id")); const destinationShopId = ShopIdSchema.parse(requiredString(row, "destination_shop_id")); const kind = z.enum(["valid", "invalid"]).parse(requiredString(row, "kind")); const previewHash = CopyPreviewHashSchema.parse(requiredString(row, "active_preview_hash")); const sourceSnapshotId = CopySourceSnapshotIdSchema.parse(requiredString(row, "source_snapshot_id")); const requirementSnapshotId = CopyRequirementSnapshotIdSchema.parse(requiredString(row, "requirement_snapshot_id")); const sourceSnapshotHash = CopyPreviewHashSchema.parse(sourceSnapshotId.replace(/^source:/, "")); const requirementSnapshotHash = CopyPreviewHashSchema.parse(requirementSnapshotId.replace(/^requirements:/, "")); const base = { sourceSnapshotId, requirementSnapshotId, sourceSnapshotHash, requirementSnapshotHash, previewHash, organizationId, destinationShopId, mutationBoundary: { mode: "preview_only" as const, preConfirmationShopeeMutationTotal: 0 as const } }
  const preview: CopyPreview = kind === "valid" ? { kind, ...base, title: requiredString(row, "title"), description: requiredString(row, "description"), categoryId: requiredString(row, "category_id"), attributes: parseObject(row["attributes"]) } : { kind, ...base, errors: z.array(z.object({ code: z.string() }).passthrough()).parse(parseJson(row["errors"])) as CopyPreview extends { kind: "invalid"; errors: infer E } ? E : never }
  return { preview, intent: { copyIntentId: CopyIntentIdSchema.parse(requiredString(row, "copy_intent_id")), organizationId, sourceSnapshotId: preview.sourceSnapshotId, destinationShopId, activePreviewHash: previewHash, commandVersion: requiredNumber(row, "command_version"), serializationGeneration: requiredNumber(row, "serialization_generation") } }
}
function parseJson(value: unknown): unknown { if (typeof value !== "string") throw new CopyPreviewPersistenceError("invalid_row"); return JSON.parse(value) }
function parseObject(value: unknown): Readonly<Record<string, string>> { const parsed = z.record(z.string(), z.string()).parse(parseJson(value)); return Object.freeze({ ...parsed }) }
