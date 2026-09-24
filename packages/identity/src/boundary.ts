import { z } from "zod"
import type { AuthorizationRequest } from "./authorize.ts"
import { IdentitySchema, OrganizationIdSchema, ShopIdSchema } from "./model.ts"
import { PERMISSIONS } from "./permissions.ts"

export const AuthorizationRequestSchema = z
  .object({
    identity: IdentitySchema,
    organizationId: OrganizationIdSchema,
    permission: z.enum(PERMISSIONS),
    expectedAuthzRevision: z.number().int().positive(),
    shopIds: z.array(ShopIdSchema).max(100).readonly(),
    recoveryApproval: z.boolean(),
  })
  .strict()
  .readonly()

export function parseAuthorizationRequest(input: unknown): AuthorizationRequest {
  return AuthorizationRequestSchema.parse(input)
}
