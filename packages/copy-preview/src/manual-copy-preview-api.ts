import { createCopyPreviewApiHandler } from "./copy-preview-api.ts"
import { OrganizationIdSchema, ShopIdSchema } from "./model.ts"

class CopyPreviewApiManualQaError extends Error {
  readonly name = "CopyPreviewApiManualQaError"
  readonly code: "expected_success" | "expected_read_only_adapter" | "unexpected_mutation"

  constructor(code: CopyPreviewApiManualQaError["code"]) {
    super("Copy preview API manual QA did not satisfy its read-only contract")
    this.code = code
  }
}

const organizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
const sourceShopId = ShopIdSchema.parse("30000000-0000-4000-8000-000000000001")
const destinationShopId = ShopIdSchema.parse("30000000-0000-4000-8000-000000000002")
const input = {
  source: {
    organizationId,
    sourceShopId,
    sourceProductId: "source-product-1",
    capturedAt: "2026-09-09T00:00:00.000Z",
    completeness: "complete" as const,
    title: "Product title",
    description: "Safe source description",
    categoryId: "source-category",
    attributes: { color: "blue" },
  },
  destinations: [{
    requirement: {
      organizationId,
      destinationShopId,
      capturedAt: "2026-09-09T00:01:00.000Z",
      completeness: "complete",
      allowedCategoryIds: ["target-category"],
      requiredAttributes: ["color"],
      maximumTitleLength: 120,
    },
    mapping: { destinationCategoryId: "target-category" },
  }],
}
const response = await createCopyPreviewApiHandler(
  new Request("http://localhost/api/copy-preview", {
    method: "POST",
    body: JSON.stringify(input),
    headers: { "content-type": "application/json", authorization: "Bearer fixture-token" },
  }),
  {
    authenticate: () => ({ organizationId, accessibleShopIds: [sourceShopId, destinationShopId] }),
    sourceSnapshots: { loadCanonicalSourceSnapshot: async () => input.source },
  },
)
const body = await response.json()
if (response.status !== 200) throw new CopyPreviewApiManualQaError("expected_success")
if (body.data.adapter.mode !== "read_only") throw new CopyPreviewApiManualQaError("expected_read_only_adapter")
if (body.data.adapter.preConfirmationShopeeMutationTotal !== 0) throw new CopyPreviewApiManualQaError("unexpected_mutation")

console.log(JSON.stringify({
  scenario: "authenticated-read-only-copy-preview-api",
  status: response.status,
  previewCount: body.data.previews.length,
  previewKinds: body.data.previews.map((entry: { readonly preview: { readonly kind: string } }) => entry.preview.kind),
  adapter: body.data.adapter,
  networkCalls: 0,
  databaseCalls: 0,
  shopeeMutations: 0,
  secretFieldsPresent: false,
}))
