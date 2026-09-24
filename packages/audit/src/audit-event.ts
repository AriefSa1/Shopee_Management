import { z } from "zod"
import {
  OrganizationIdSchema,
  RoleSchema,
  ShopIdSchema,
  UserIdSchema,
} from "../../identity/src/model.ts"
import { PERMISSIONS } from "../../identity/src/permissions.ts"

export const AuditEventIdSchema = z.string().uuid().brand("AuditEventId")
export const CorrelationIdSchema = z.string().uuid().brand("CorrelationId")

const AuthorizationDecisionDetailsSchema = z
  .object({
    kind: z.literal("authorization_decision"),
    permission: z.enum(PERMISSIONS),
    decision: z.enum(["allow", "deny"]),
    reasonCode: z.string().regex(/^[a-z][a-z0-9_]*$/),
    shopIds: z.array(ShopIdSchema).max(100).readonly(),
  })
  .strict()
  .readonly()

const MembershipChangedDetailsSchema = z
  .object({
    kind: z.literal("membership_changed"),
    targetUserId: UserIdSchema,
    targetRole: RoleSchema,
    authzRevision: z.number().int().positive(),
    resultCode: z.enum(["created", "role_changed", "revoked"]),
  })
  .strict()
  .readonly()

const ShopConnectionChangedDetailsSchema = z
  .object({
    kind: z.literal("shop_connection_changed"),
    shopId: ShopIdSchema,
    actionCode: z.enum(["authorized", "reauthorized", "disconnected"]),
    resultCode: z.string().regex(/^[a-z][a-z0-9_]*$/),
  })
  .strict()
  .readonly()

export const AuditEventDetailsSchema = z.union([
  AuthorizationDecisionDetailsSchema,
  MembershipChangedDetailsSchema,
  ShopConnectionChangedDetailsSchema,
])

export const AuditEventSchema = z
  .object({
    eventId: AuditEventIdSchema,
    version: z.literal(1),
    organizationId: OrganizationIdSchema,
    actorUserId: UserIdSchema,
    correlationId: CorrelationIdSchema,
    occurredAt: z.string().datetime({ offset: true }),
    details: AuditEventDetailsSchema,
  })
  .strict()
  .readonly()

export type AuditEvent = z.infer<typeof AuditEventSchema>

export function parseAuditEvent(input: unknown): AuditEvent {
  return AuditEventSchema.parse(input)
}

export interface AppendOnlyAuditSink {
  append(event: AuditEvent): Promise<void>
}
