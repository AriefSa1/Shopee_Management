import assert from "node:assert/strict"
import { describe, it } from "node:test"
import * as preview from "./copy-preview.ts"

describe("copy preview contracts", () => {
  it("creates a deterministic preview without enabling a mutation", () => {
    // Given: one fully captured source and destination requirement snapshot.
    const input = {
      source: {
        organizationId: "10000000-0000-4000-8000-000000000001",
        sourceShopId: "30000000-0000-4000-8000-000000000001",
        sourceProductId: "source-product-1",
        capturedAt: "2026-09-09T00:00:00.000Z",
        completeness: "complete",
        title: "Product title",
        description: "Safe source description",
        categoryId: "source-category",
        attributes: { color: "blue" },
      },
      requirement: {
        organizationId: "10000000-0000-4000-8000-000000000001",
        destinationShopId: "30000000-0000-4000-8000-000000000002",
        capturedAt: "2026-09-09T00:01:00.000Z",
        completeness: "complete",
        allowedCategoryIds: ["target-category"],
        requiredAttributes: ["color"],
        maximumTitleLength: 120,
      },
      mapping: { destinationCategoryId: "target-category" },
    }

    // When: a local-only preview is built twice from the same snapshots.
    const first = preview.createCopyPreview(input)
    const second = preview.createCopyPreview(input)

    // Then: it is valid and stable, with no mutation surface enabled.
    assert.equal(first.kind, "valid")
    assert.equal(first.previewHash, second.previewHash)
    assert.equal(first.mutationBoundary.preConfirmationShopeeMutationTotal, 0)
  })

  it("keeps a preview immutable when the caller later changes its source object", () => {
    // Given: a mutable caller-owned fixture with complete snapshots.
    const input = validInput()

    // When: the caller changes the fixture after preview creation.
    const result = preview.createCopyPreview(input)
    input.source.title = "Changed after capture"

    // Then: the saved preview remains the original local snapshot projection.
    assert.equal(result.kind, "valid")
    if (result.kind !== "valid") return
    assert.equal(result.title, "Product title")
  })

  it("reports incomplete snapshots and destination mapping errors per preview", () => {
    // Given: a destination lacking a complete requirement capture and a supported category mapping.
    const input = validInput()
    input.source.completeness = "incomplete"
    input.requirement.completeness = "incomplete"
    input.mapping.destinationCategoryId = "unsupported-category"

    // When: the local validator maps the source for that destination.
    const result = preview.createCopyPreview(input)

    // Then: the preview is invalid before a remote mutation could be attempted.
    assert.equal(result.kind, "invalid")
    if (result.kind !== "invalid") return
    assert.deepEqual(result.errors, [
      { code: "source_incomplete" },
      { code: "requirements_incomplete" },
      { code: "destination_category_unsupported" },
    ])
  })

  it("supersedes a valid preview by advancing only its command serialization", () => {
    // Given: one stable intent and an edited local preview for its same source/destination pair.
    const initial = preview.createCopyPreview(validInput())
    const editedInput = validInput()
    editedInput.source.description = "Edited local description"
    const edited = preview.createCopyPreview(editedInput)
    assert.equal(initial.kind, "valid")
    if (initial.kind !== "valid") return
    const intent = preview.createStableCopyIntent(initial)

    // When: the edited preview supersedes before any external operation has started.
    const superseded = preview.supersedeCopyIntent({
      intent,
      nextPreview: edited,
      externalMutationStarted: false,
      published: false,
    })

    // Then: logical intent is preserved while command and generation advance once.
    assert.equal(superseded.kind, "superseded")
    if (superseded.kind !== "superseded") return
    assert.equal(superseded.intent.copyIntentId, intent.copyIntentId)
    assert.equal(superseded.intent.commandVersion, 2)
    assert.equal(superseded.intent.serializationGeneration, 2)
  })

  it("denies supersede and rejects a mutation attempt after an external outcome begins", () => {
    // Given: a valid intent whose external outcome would require reconciliation.
    const initial = preview.createCopyPreview(validInput())
    assert.equal(initial.kind, "valid")
    if (initial.kind !== "valid") return

    // When: a user tries to supersede and invoke the forbidden pre-confirmation mutation boundary.
    const denied = preview.supersedeCopyIntent({
      intent: preview.createStableCopyIntent(initial),
      nextPreview: initial,
      externalMutationStarted: true,
      published: false,
    })

    // Then: local serialization refuses the edit and the adapter boundary has no mutation route.
    assert.deepEqual(denied, { kind: "denied", reason: "external_outcome_unresolved" })
    assert.throws(() => preview.rejectPreConfirmationShopeeMutation(), {
      code: "pre_confirmation_mutation_disabled",
    })
    assert.deepEqual(preview.createReadOnlyCopyPreviewAdapter(), {
      mode: "read_only",
      preConfirmationShopeeMutationTotal: 0,
    })
  })

  it("builds ten independent destinations in deterministic shop order", () => {
    // Given: ten complete destination requirement snapshots presented in reverse order.
    const source = validInput().source
    const destinations = Array.from({ length: 10 }, (_, index) => {
      const suffix = String(10 - index).padStart(12, "0")
      return {
        requirement: { ...validInput().requirement, destinationShopId: `30000000-0000-4000-8000-${suffix}` },
        mapping: { destinationCategoryId: "target-category" },
      }
    })

    // When: batch preview builds every destination locally.
    const results = preview.createDestinationPreviews({ source, destinations })

    // Then: all ten outcomes are valid and stable-sorted independently by destination.
    assert.equal(results.length, 10)
    assert.deepEqual(results.map((entry) => entry.preview.kind), Array(10).fill("valid"))
    assert.deepEqual(
      results.map((entry) => entry.destinationShopId),
      [...results.map((entry) => entry.destinationShopId)].sort((left, right) => left.localeCompare(right)),
    )
  })
})

function validInput() {
  return {
    source: {
      organizationId: "10000000-0000-4000-8000-000000000001",
      sourceShopId: "30000000-0000-4000-8000-000000000001",
      sourceProductId: "source-product-1",
      capturedAt: "2026-09-09T00:00:00.000Z",
      completeness: "complete",
      title: "Product title",
      description: "Safe source description",
      categoryId: "source-category",
      attributes: { color: "blue" },
    },
    requirement: {
      organizationId: "10000000-0000-4000-8000-000000000001",
      destinationShopId: "30000000-0000-4000-8000-000000000002",
      capturedAt: "2026-09-09T00:01:00.000Z",
      completeness: "complete",
      allowedCategoryIds: ["target-category"],
      requiredAttributes: ["color"],
      maximumTitleLength: 120,
    },
    mapping: { destinationCategoryId: "target-category" },
  }
}
