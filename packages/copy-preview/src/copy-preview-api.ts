import { CopyPreviewBatchInputSchema } from "./copy-preview.ts"
import {
  createDestinationPreviews,
  createReadOnlyCopyPreviewAdapter,
} from "./copy-preview.ts"
import { hashCopyPreviewValue } from "./serialization.ts"
import {
  ShopIdSchema,
  OrganizationIdSchema,
  type CopySourceSnapshotRepository,
  type OrganizationId,
  type ShopId,
} from "./model.ts"

export type CopyPreviewReadContext = {
  readonly organizationId: OrganizationId
  readonly accessibleShopIds: readonly ShopId[]
}

export type CopyPreviewApiDependencies = {
  readonly authenticate: (request: Request) => CopyPreviewReadContext | null
  readonly sourceSnapshots: CopySourceSnapshotRepository
}

export async function createCopyPreviewApiHandler(
  request: Request,
  dependencies: CopyPreviewApiDependencies,
): Promise<Response> {
  if (request.headers.get("authorization")?.startsWith("Bearer ") !== true) {
    return json({ error: { code: "authentication_required" } }, 401)
  }
  const context = dependencies.authenticate(request)
  if (context === null) return json({ error: { code: "authentication_required" } }, 401)

  let rawInput: unknown
  try {
    rawInput = await request.json()
  } catch (error) {
    if (error instanceof SyntaxError) return json({ error: { code: "invalid_copy_preview_request" } }, 400)
    throw error
  }
  const parsed = CopyPreviewBatchInputSchema.safeParse(rawInput)
  if (!parsed.success) return json({ error: { code: "invalid_copy_preview_request" } }, 400)

  if (parsed.data.source.organizationId !== context.organizationId) {
    return json({ error: { code: "organization_mismatch" } }, 403)
  }
  const sourceAccess = checkShopAccess(context, parsed.data.source.sourceShopId)
  if (sourceAccess !== null) return json(sourceAccess, 403)
  const sourceLookup = {
    organizationId: parsed.data.source.organizationId,
    sourceShopId: parsed.data.source.sourceShopId,
    sourceProductId: parsed.data.source.sourceProductId,
  }
  const canonicalSource = await dependencies.sourceSnapshots.loadCanonicalSourceSnapshot(sourceLookup)
  if (
    canonicalSource === null ||
    canonicalSource.organizationId !== sourceLookup.organizationId ||
    canonicalSource.sourceShopId !== sourceLookup.sourceShopId ||
    canonicalSource.sourceProductId !== sourceLookup.sourceProductId ||
    hashCopyPreviewValue(canonicalSource) !== hashCopyPreviewValue(parsed.data.source)
  ) {
    return json({ error: { code: "source_snapshot_mismatch" } }, 403)
  }
  for (const destination of parsed.data.destinations) {
    if (destination.requirement.organizationId !== context.organizationId) {
      return json({ error: { code: "organization_mismatch" } }, 403)
    }
    const destinationAccess = checkShopAccess(context, destination.requirement.destinationShopId)
    if (destinationAccess !== null) return json(destinationAccess, 403)
  }

  const previews = createDestinationPreviews(parsed.data)
  return json({
    data: {
      organizationId: context.organizationId,
      previews,
      adapter: createReadOnlyCopyPreviewAdapter(),
    },
  }, 200)
}

function checkShopAccess(
  context: CopyPreviewReadContext,
  shopId: ShopId,
): { readonly error: { readonly code: "shop_not_accessible"; readonly shopId: ShopId } } | null {
  return context.accessibleShopIds.includes(shopId)
    ? null
    : { error: { code: "shop_not_accessible", shopId } }
}

function json(body: object, status: 200 | 400 | 401 | 403): Response {
  return Response.json(body, { status })
}

export { OrganizationIdSchema, ShopIdSchema }
