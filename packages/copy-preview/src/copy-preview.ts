import {
  CopyIntentIdSchema,
  CopyPreviewInputSchema,
  CopySourceSnapshotIdSchema,
  CopyRequirementSnapshotIdSchema,
  type CopyDestinationPreviewResult,
  type CopyIntent,
  type CopyIntentSupersedeResult,
  type CopyPreview,
  type CopyPreviewInput,
  type CopySourceSnapshot,
  type CopyValidationError,
  type DestinationRequirementSnapshot,
  type PreviewOnlyMutationBoundary,
} from "./model.ts"
import { hashCopyPreviewValue } from "./serialization.ts"

const previewOnlyMutationBoundary: PreviewOnlyMutationBoundary = Object.freeze({
  mode: "preview_only",
  preConfirmationShopeeMutationTotal: 0,
})

export type CopyPreviewReadAdapter = {
  readonly mode: "read_only"
  readonly preConfirmationShopeeMutationTotal: 0
}

export function createCopyPreview(rawInput: unknown): CopyPreview {
  const input = CopyPreviewInputSchema.parse(rawInput)
  const sourceSnapshotHash = hashCopyPreviewValue(normalizeSource(input.source))
  const requirementSnapshotHash = hashCopyPreviewValue(normalizeRequirement(input.requirement))
  const sourceSnapshotId = CopySourceSnapshotIdSchema.parse(`source:${sourceSnapshotHash}`)
  const requirementSnapshotId = CopyRequirementSnapshotIdSchema.parse(`requirements:${requirementSnapshotHash}`)
  const errors = validatePreview(input)
  const previewHash = hashCopyPreviewValue({
    sourceSnapshotHash,
    requirementSnapshotHash,
    mapping: input.mapping,
    errors,
  })

  if (errors.length > 0) {
    return {
      kind: "invalid",
      sourceSnapshotId,
      requirementSnapshotId,
      sourceSnapshotHash,
      requirementSnapshotHash,
      previewHash,
      organizationId: input.source.organizationId,
      destinationShopId: input.requirement.destinationShopId,
      errors,
      mutationBoundary: previewOnlyMutationBoundary,
    }
  }

  return {
    kind: "valid",
    sourceSnapshotId,
    requirementSnapshotId,
    sourceSnapshotHash,
    requirementSnapshotHash,
    previewHash,
    organizationId: input.source.organizationId,
    destinationShopId: input.requirement.destinationShopId,
    title: input.source.title,
    description: input.source.description,
    categoryId: input.mapping.destinationCategoryId,
    attributes: Object.freeze({ ...input.source.attributes }),
    mutationBoundary: previewOnlyMutationBoundary,
  }
}

export function createDestinationPreviews(rawInput: unknown): readonly CopyDestinationPreviewResult[] {
  const input = CopyPreviewBatchInputSchema.parse(rawInput)
  return input.destinations
    .map((destination) => ({
      destinationShopId: destination.requirement.destinationShopId,
      preview: createCopyPreview({ source: input.source, ...destination }),
    }))
    .sort((left, right) => left.destinationShopId.localeCompare(right.destinationShopId))
}

export function createStableCopyIntent(preview: CopyPreview): CopyIntent {
  if (preview.kind === "invalid") throw new CopyPreviewContractError("invalid_preview_cannot_create_intent")
  return {
    copyIntentId: CopyIntentIdSchema.parse(`intent:${hashCopyPreviewValue({
      sourceSnapshotId: preview.sourceSnapshotId,
      destinationShopId: preview.destinationShopId,
    })}`),
    organizationId: preview.organizationId,
    sourceSnapshotId: preview.sourceSnapshotId,
    destinationShopId: preview.destinationShopId,
    activePreviewHash: preview.previewHash,
    commandVersion: 1,
    serializationGeneration: 1,
  }
}

export function supersedeCopyIntent(input: {
  readonly intent: CopyIntent
  readonly nextPreview: CopyPreview
  readonly externalMutationStarted: boolean
  readonly published: boolean
}): CopyIntentSupersedeResult {
  if (input.nextPreview.kind === "invalid") return { kind: "denied", reason: "preview_invalid" }
  if (input.published) return { kind: "denied", reason: "already_published" }
  if (input.externalMutationStarted) return { kind: "denied", reason: "external_outcome_unresolved" }
  return {
    kind: "superseded",
    intent: {
      ...input.intent,
      activePreviewHash: input.nextPreview.previewHash,
      commandVersion: input.intent.commandVersion + 1,
      serializationGeneration: input.intent.serializationGeneration + 1,
    },
  }
}

export function createReadOnlyCopyPreviewAdapter(): CopyPreviewReadAdapter {
  return { mode: "read_only", preConfirmationShopeeMutationTotal: 0 }
}

export function rejectPreConfirmationShopeeMutation(): never {
  throw new CopyPreviewContractError("pre_confirmation_mutation_disabled")
}

export const CopyPreviewBatchInputSchema = CopyPreviewInputSchema.pick({ source: true })
  .extend({
    destinations: CopyPreviewInputSchema.pick({ requirement: true, mapping: true }).array().min(1),
  })
  .strict()

function validatePreview(input: CopyPreviewInput): readonly CopyValidationError[] {
  const errors: CopyValidationError[] = []
  if (input.source.organizationId !== input.requirement.organizationId) errors.push({ code: "organization_mismatch" })
  if (input.source.completeness !== "complete") errors.push({ code: "source_incomplete" })
  if (input.requirement.completeness !== "complete") errors.push({ code: "requirements_incomplete" })
  if (!input.requirement.allowedCategoryIds.includes(input.mapping.destinationCategoryId)) {
    errors.push({ code: "destination_category_unsupported" })
  }
  if (input.source.title.length > input.requirement.maximumTitleLength) errors.push({ code: "title_too_long" })
  for (const attribute of [...input.requirement.requiredAttributes].sort((left, right) => left.localeCompare(right))) {
    if (input.source.attributes[attribute] === undefined) errors.push({ code: "required_attribute_missing", attribute })
  }
  return Object.freeze(errors)
}

function normalizeSource(source: CopySourceSnapshot): CopySourceSnapshot {
  return { ...source, attributes: Object.freeze({ ...source.attributes }) }
}

function normalizeRequirement(requirement: DestinationRequirementSnapshot): DestinationRequirementSnapshot {
  return {
    ...requirement,
    allowedCategoryIds: [...requirement.allowedCategoryIds].sort((left, right) => left.localeCompare(right)),
    requiredAttributes: [...requirement.requiredAttributes].sort((left, right) => left.localeCompare(right)),
  }
}

export class CopyPreviewContractError extends Error {
  readonly name = "CopyPreviewContractError"
  readonly code:
    | "invalid_preview_cannot_create_intent"
    | "pre_confirmation_mutation_disabled"

  constructor(code: CopyPreviewContractError["code"]) {
    super("Copy preview contract rejected an unsafe preview-only operation")
    this.code = code
  }
}
