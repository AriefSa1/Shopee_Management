import {
  CommandIdSchema,
  DeadLetterIdSchema,
  EventIdSchema,
  JobIdSchema,
  OrganizationIdSchema,
  WorkerIdSchema,
} from "./contracts.ts"
import type { QueueJob, QueueJobState } from "./delivery-types.ts"
import type { SqlParameter, SqlRow, SqlStatement } from "./postgres-delivery.ts"

export const QUEUE_JOB_COLUMNS = `organization_id, job_id, command_id, outbox_event_id,
  replay_of_dead_letter_id, state, available_at, attempt_count, lease_owner,
  lease_expires_at, fencing_generation, completed_at, acknowledged_at`

export function statement(name: string, text: string, params: readonly SqlParameter[]): SqlStatement {
  return { name, text, params }
}

export function requiredString(row: SqlRow, key: string): string {
  const value = row[key]
  if (typeof value !== "string") throw new Error(`Invalid delivery row field: ${key}`)
  return value
}

function optionalString(row: SqlRow, key: string): string | undefined {
  const value = row[key]
  if (value === null || value === undefined) return undefined
  if (typeof value !== "string") throw new Error(`Invalid delivery row field: ${key}`)
  return value
}

function requiredNumber(row: SqlRow, key: string): number {
  const value = row[key]
  if (typeof value !== "number") throw new Error(`Invalid delivery row field: ${key}`)
  return value
}

function queueState(value: string): QueueJobState {
  if (
    value === "PENDING" ||
    value === "LEASED" ||
    value === "COMPLETED" ||
    value === "ACKNOWLEDGED" ||
    value === "RETRY_SCHEDULED" ||
    value === "DEAD_LETTERED"
  ) return value
  throw new Error(`Invalid queue state: ${value}`)
}

export function queueJob(row: SqlRow): QueueJob {
  const outboxEventId = optionalString(row, "outbox_event_id")
  const replayOfDeadLetterId = optionalString(row, "replay_of_dead_letter_id")
  const leaseOwner = optionalString(row, "lease_owner")
  const leaseExpiresAt = optionalString(row, "lease_expires_at")
  const completedAt = optionalString(row, "completed_at")
  const acknowledgedAt = optionalString(row, "acknowledged_at")
  return {
    organizationId: OrganizationIdSchema.parse(requiredString(row, "organization_id")),
    jobId: JobIdSchema.parse(requiredString(row, "job_id")),
    commandId: CommandIdSchema.parse(requiredString(row, "command_id")),
    ...(outboxEventId === undefined ? {} : { outboxEventId: EventIdSchema.parse(outboxEventId) }),
    ...(replayOfDeadLetterId === undefined ? {} : { replayOfDeadLetterId: DeadLetterIdSchema.parse(replayOfDeadLetterId) }),
    state: queueState(requiredString(row, "state")),
    availableAt: requiredString(row, "available_at"),
    attemptCount: requiredNumber(row, "attempt_count"),
    ...(leaseOwner === undefined ? {} : { leaseOwner: WorkerIdSchema.parse(leaseOwner) }),
    ...(leaseExpiresAt === undefined ? {} : { leaseExpiresAt }),
    fencingGeneration: requiredNumber(row, "fencing_generation"),
    ...(completedAt === undefined ? {} : { completedAt }),
    ...(acknowledgedAt === undefined ? {} : { acknowledgedAt }),
  }
}

export function onlyJob(rows: readonly SqlRow[]): QueueJob {
  const row = rows[0]
  if (row === undefined) throw new Error("Expected one queue job row")
  return queueJob(row)
}

export function onlyJobOrUndefined(rows: readonly SqlRow[]): QueueJob | undefined {
  const row = rows[0]
  return row === undefined ? undefined : queueJob(row)
}
