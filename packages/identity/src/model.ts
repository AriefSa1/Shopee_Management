import { z } from "zod"

export const OrganizationIdSchema = z.string().uuid().brand("OrganizationId")
export type OrganizationId = z.infer<typeof OrganizationIdSchema>

export const UserIdSchema = z.string().uuid().brand("UserId")
export type UserId = z.infer<typeof UserIdSchema>

export const ShopIdSchema = z.string().uuid().brand("ShopId")
export type ShopId = z.infer<typeof ShopIdSchema>

export const IdentitySchema = z
  .object({
    issuer: z.string().url(),
    subject: z.string().trim().min(1).max(255),
  })
  .strict()

export type Identity = z.infer<typeof IdentitySchema>

export const RoleSchema = z.enum(["owner", "admin", "staff"])
export type Role = z.infer<typeof RoleSchema>

export const MembershipStatusSchema = z.enum(["active", "revoked"])
export type MembershipStatus = z.infer<typeof MembershipStatusSchema>

export const MembershipSchema = z
  .object({
    organizationId: OrganizationIdSchema,
    userId: UserIdSchema,
    identity: IdentitySchema,
    role: RoleSchema,
    status: MembershipStatusSchema,
    authzRevision: z.number().int().positive(),
  })
  .strict()
  .readonly()

export type Membership = z.infer<typeof MembershipSchema>

export type ShopOwnership = {
  readonly organizationId: OrganizationId
  readonly shopId: ShopId
}
