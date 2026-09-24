import {
  createCopyPreview,
  createDestinationPreviews,
  createReadOnlyCopyPreviewAdapter,
  createStableCopyIntent,
  supersedeCopyIntent,
} from "./index.ts"

class CopyPreviewManualQaError extends Error {
  readonly name = "CopyPreviewManualQaError"
  readonly code: "expected_valid_preview"

  constructor(code: "expected_valid_preview") {
    super("Copy preview manual QA did not produce its required valid preview")
    this.code = code
  }
}

const source = {
  organizationId: "10000000-0000-4000-8000-000000000001",
  sourceShopId: "30000000-0000-4000-8000-000000000001",
  sourceProductId: "source-product-1",
  capturedAt: "2026-09-09T00:00:00.000Z",
  completeness: "complete",
  title: "Product title",
  description: "Safe source description",
  categoryId: "source-category",
  attributes: { color: "blue" },
}
const requirement = {
  organizationId: "10000000-0000-4000-8000-000000000001",
  destinationShopId: "30000000-0000-4000-8000-000000000002",
  capturedAt: "2026-09-09T00:01:00.000Z",
  completeness: "complete",
  allowedCategoryIds: ["target-category"],
  requiredAttributes: ["color"],
  maximumTitleLength: 120,
}
const preview = createCopyPreview({ source, requirement, mapping: { destinationCategoryId: "target-category" } })
if (preview.kind !== "valid") throw new CopyPreviewManualQaError("expected_valid_preview")

const intent = createStableCopyIntent(preview)
const edited = createCopyPreview({
  source: { ...source, description: "Edited local description" },
  requirement,
  mapping: { destinationCategoryId: "target-category" },
})
const superseded = supersedeCopyIntent({
  intent,
  nextPreview: edited,
  externalMutationStarted: false,
  published: false,
})
const destinations = createDestinationPreviews({
  source,
  destinations: [
    { requirement, mapping: { destinationCategoryId: "target-category" } },
    {
      requirement: { ...requirement, destinationShopId: "30000000-0000-4000-8000-000000000003" },
      mapping: { destinationCategoryId: "target-category" },
    },
  ],
})

console.log(
  JSON.stringify({
    scenario: "local-copy-preview-with-supersede-and-zero-mutation",
    previewKind: preview.kind,
    previewHash: preview.previewHash,
    destinationPreviewKinds: destinations.map((entry) => entry.preview.kind),
    supersedeKind: superseded.kind,
    commandVersion: superseded.kind === "superseded" ? superseded.intent.commandVersion : null,
    adapter: createReadOnlyCopyPreviewAdapter(),
    networkCalls: 0,
    secretFieldsPresent: false,
  }),
)
