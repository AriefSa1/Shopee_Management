import { z } from "zod"

export const OrganizationIdSchema = z.string().uuid().brand("OrganizationId")
export const CommandIdSchema = z.string().uuid().brand("CommandId")
export const EventIdSchema = z.string().uuid().brand("EventId")
export const JobIdSchema = z.string().uuid().brand("JobId")
export const DeadLetterIdSchema = z.string().uuid().brand("DeadLetterId")
export const TriggerIdSchema = z.string().uuid().brand("TriggerId")
export const WorkerIdSchema = z.string().min(1).max(128).brand("WorkerId")
export const DedupeKeySchema = z.string().min(1).max(256).brand("DedupeKey")

export type OrganizationId = z.infer<typeof OrganizationIdSchema>
export type CommandId = z.infer<typeof CommandIdSchema>
export type EventId = z.infer<typeof EventIdSchema>
export type JobId = z.infer<typeof JobIdSchema>
export type DeadLetterId = z.infer<typeof DeadLetterIdSchema>
export type TriggerId = z.infer<typeof TriggerIdSchema>
export type WorkerId = z.infer<typeof WorkerIdSchema>
export type DedupeKey = z.infer<typeof DedupeKeySchema>

const jsonPrimitiveSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null()])
export type JsonValue = z.infer<typeof jsonPrimitiveSchema> | JsonObject | readonly JsonValue[]
export type JsonObject = { readonly [key: string]: JsonValue }

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([jsonPrimitiveSchema, z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema)]),
)
const jsonObjectSchema: z.ZodType<JsonObject> = z.record(z.string(), jsonValueSchema)

const FORBIDDEN_PAYLOAD_KEYS = [
  "authorization",
  "cookie",
  "password",
  "partnerkey",
  "secret",
  "token",
] as const

function findForbiddenPayloadKey(value: JsonValue): string | undefined {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const forbiddenKey = findForbiddenPayloadKey(entry)
      if (forbiddenKey !== undefined) return forbiddenKey
    }
    return undefined
  }
  if (value === null || typeof value !== "object") return undefined
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = key.replaceAll(/[^a-z0-9]/gi, "").toLowerCase()
    if (FORBIDDEN_PAYLOAD_KEYS.some((candidate) => normalizedKey.includes(candidate))) return key
    const forbiddenKey = findForbiddenPayloadKey(entry)
    if (forbiddenKey !== undefined) return forbiddenKey
  }
  return undefined
}

const commandEnvelopeSchema = z.object({
  organizationId: OrganizationIdSchema,
  commandId: CommandIdSchema,
  commandType: z.string().min(1).max(128),
  schemaVersion: z.number().int().positive(),
  aggregateType: z.string().min(1).max(128),
  aggregateId: z.string().min(1).max(256),
  dedupeKey: DedupeKeySchema,
  createdAt: z.string().datetime({ offset: true }),
  payload: jsonObjectSchema.superRefine((payload, context) => {
    const forbiddenKey = findForbiddenPayloadKey(payload)
    if (forbiddenKey !== undefined) {
      context.addIssue({ code: "custom", message: "Command payload contains a sensitive field" })
    }
  }),
}).strict()

export type CommandEnvelope = Readonly<z.infer<typeof commandEnvelopeSchema>>

export function parseCommandEnvelope(input: unknown): CommandEnvelope {
  return commandEnvelopeSchema.parse(input)
}

export const DELIVERY_SEMANTICS = "at-least-once" as const
