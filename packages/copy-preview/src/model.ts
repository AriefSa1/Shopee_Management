import { z } from "zod"
import {
  OrganizationIdSchema,
  ShopIdSchema,
  type OrganizationId,
  type ShopId,
} from "../../identity/src/model.ts"

export { OrganizationIdSchema, ShopIdSchema }
export type { OrganizationId, ShopId }

export const CopySourceSnapshotIdSchema = z.string().min(1).max(128).brand("CopySourceSnapshotId")
export const CopyRequirementSnapshotIdSchema = z.string().min(1).max(128).brand("CopyRequirementSnapshotId")
export const CopyIntentIdSchema = z.string().min(1).max(128).brand("CopyIntentId")
export const CopyPreviewHashSchema = z.string().regex(/^[a-f0-9]{64}$/).brand("CopyPreviewHash")
export const CopyTimestampSchema = z.string().datetime({ offset: true })
export const CopyCompletenessSchema = z.enum(["complete", "incomplete"])

export type CopySourceSnapshotId = z.infer<typeof CopySourceSnapshotIdSchema>
export type CopyRequirementSnapshotId = z.infer<typeof CopyRequirementSnapshotIdSchema>
export type CopyIntentId = z.infer<typeof CopyIntentIdSchema>
export type CopyPreviewHash = z.infer<typeof CopyPreviewHashSchema>
export type CopyCompleteness = z.infer<typeof CopyCompletenessSchema>

export const CopySourceSnapshotSchema = z
  .object({
    organizationId: OrganizationIdSchema,
    sourceShopId: ShopIdSchema,
    sourceProductId: z.string().trim().min(1).max(255),
    capturedAt: CopyTimestampSchema,
    completeness: CopyCompletenessSchema,
    title: z.string().trim().min(1).max(255),
    description: z.string().max(10_000),
    categoryId: z.string().trim().min(1).max(255),
    attributes: z.record(z.string().trim().min(1), z.string().trim().min(1)),
  })
  .strict()
  .readonly()

export const DestinationRequirementSnapshotSchema = z
  .object({
    organizationId: OrganizationIdSchema,
    destinationShopId: ShopIdSchema,
    capturedAt: CopyTimestampSchema,
    completeness: CopyCompletenessSchema,
    allowedCategoryIds: z.array(z.string().trim().min(1).max(255)).min(1),
    requiredAttributes: z.array(z.string().trim().min(1).max(255)),
    maximumTitleLength: z.number().int().positive().max(255),
  })
  .strict()
  .readonly()

export const DestinationMappingSchema = z
  .object({ destinationCategoryId: z.string().trim().min(1).max(255) })
  .strict()
  .readonly()

export const CopyPreviewInputSchema = z
  .object({
    source: CopySourceSnapshotSchema,
    requirement: DestinationRequirementSnapshotSchema,
    mapping: DestinationMappingSchema,
  })
  .strict()

export type CopySourceSnapshot = z.infer<typeof CopySourceSnapshotSchema>
export type DestinationRequirementSnapshot = z.infer<typeof DestinationRequirementSnapshotSchema>
export type DestinationMapping = z.infer<typeof DestinationMappingSchema>
export type CopyPreviewInput = z.infer<typeof CopyPreviewInputSchema>

export type CopySourceSnapshotLookup = {
  readonly organizationId: OrganizationId
  readonly sourceShopId: ShopId
  readonly sourceProductId: string
}

export type CopySourceSnapshotRepository = {
  readonly loadCanonicalSourceSnapshot: (
    lookup: CopySourceSnapshotLookup,
  ) => Promise<CopySourceSnapshot | null>
}

export type CopyValidationError =
  | { readonly code: "organization_mismatch" }
  | { readonly code: "source_incomplete" }
  | { readonly code: "requirements_incomplete" }
  | { readonly code: "destination_category_unsupported" }
  | { readonly code: "title_too_long" }
  | { readonly code: "required_attribute_missing"; readonly attribute: string }

export type PreviewOnlyMutationBoundary = {
  readonly mode: "preview_only"
  readonly preConfirmationShopeeMutationTotal: 0
}

export type CopyPreview =
  | {
      readonly kind: "valid"
      readonly sourceSnapshotId: CopySourceSnapshotId
      readonly requirementSnapshotId: CopyRequirementSnapshotId
      readonly sourceSnapshotHash: CopyPreviewHash
      readonly requirementSnapshotHash: CopyPreviewHash
      readonly previewHash: CopyPreviewHash
      readonly organizationId: OrganizationId
      readonly destinationShopId: ShopId
      readonly title: string
      readonly description: string
      readonly categoryId: string
      readonly attributes: Readonly<Record<string, string>>
      readonly mutationBoundary: PreviewOnlyMutationBoundary
    }
  | {
      readonly kind: "invalid"
      readonly sourceSnapshotId: CopySourceSnapshotId
      readonly requirementSnapshotId: CopyRequirementSnapshotId
      readonly sourceSnapshotHash: CopyPreviewHash
      readonly requirementSnapshotHash: CopyPreviewHash
      readonly previewHash: CopyPreviewHash
      readonly organizationId: OrganizationId
      readonly destinationShopId: ShopId
      readonly errors: readonly CopyValidationError[]
      readonly mutationBoundary: PreviewOnlyMutationBoundary
    }

export type CopyIntent = {
  readonly copyIntentId: CopyIntentId
  readonly organizationId: OrganizationId
  readonly sourceSnapshotId: CopySourceSnapshotId
  readonly destinationShopId: ShopId
  readonly activePreviewHash: CopyPreviewHash
  readonly commandVersion: number
  readonly serializationGeneration: number
}

export type CopyIntentSupersedeResult =
  | { readonly kind: "superseded"; readonly intent: CopyIntent }
  | { readonly kind: "denied"; readonly reason: "preview_invalid" | "external_outcome_unresolved" | "already_published" }

export type CopyDestinationPreviewResult = {
  readonly destinationShopId: ShopId
  readonly preview: CopyPreview
}
