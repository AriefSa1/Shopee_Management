import {
  TriggerIdSchema,
  WorkerIdSchema,
} from "./contracts.ts"
import {
  DeliveryNotFoundError,
  InvalidJobTransitionError,
  StaleLeaseError,
} from "./errors.ts"
import type {
  DeliveryDecision,
  DispatchResult,
  LeaseToken,
  QueueJob,
  ScheduleSlotResult,
} from "./delivery-types.ts"
import type {
  EventId,
  JobId,
  OrganizationId,
  TriggerId,
  WorkerId,
} from "./contracts.ts"
import {
  onlyJob,
  onlyJobOrUndefined,
  QUEUE_JOB_COLUMNS,
  requiredString,
  statement,
} from "./postgres-delivery-mappers.ts"
import {
  PostgresDeliveryRecovery,
  type DeadLetterInput,
  type ReplayInput,
} from "./postgres-delivery-recovery.ts"

export type { DeadLetterInput, ReplayInput }

export type SqlParameter = string | number | boolean | null
export type SqlRow = Readonly<Record<string, SqlParameter | undefined>> & {
  readonly attempt_count?: SqlParameter | undefined
  readonly attempt_id?: SqlParameter | undefined
  readonly available_at?: SqlParameter | undefined
  readonly collection_run_id?: SqlParameter | undefined
  readonly command_id?: SqlParameter | undefined
  readonly confirmation_binding?: SqlParameter | undefined
  readonly copy_intent_id?: SqlParameter | undefined
  readonly destination_shop_id?: SqlParameter | undefined
  readonly dispatched_at?: SqlParameter | undefined
  readonly event_id?: SqlParameter | undefined
  readonly fencing_generation?: SqlParameter | undefined
  readonly flags?: SqlParameter | undefined
  readonly job_id?: SqlParameter | undefined
  readonly lease_expires_at?: SqlParameter | undefined
  readonly lease_owner?: SqlParameter | undefined
  readonly organization_id?: SqlParameter | undefined
  readonly operation_attempt_id?: SqlParameter | undefined
  readonly outbox_event_id?: SqlParameter | undefined
  readonly active_preview_hash?: SqlParameter | undefined
  readonly preview_hash?: SqlParameter | undefined
  readonly product_id?: SqlParameter | undefined
  readonly reconciliation?: SqlParameter | undefined
  readonly replay_of_dead_letter_id?: SqlParameter | undefined
  readonly shop_id?: SqlParameter | undefined
  readonly slot_at?: SqlParameter | undefined
  readonly state?: SqlParameter | undefined
  readonly target_key?: SqlParameter | undefined
  readonly task_name?: SqlParameter | undefined
  readonly variant_id?: SqlParameter | undefined
}
export type SqlStatement = {
  readonly name: string
  readonly text: string
  readonly params: readonly SqlParameter[]
}

export interface PostgresExecutor {
  query(statement: SqlStatement): Promise<readonly SqlRow[]>
  transaction<T>(work: (executor: PostgresExecutor) => Promise<T>): Promise<T>
}

export type DispatchInput = {
  readonly organizationId: OrganizationId
  readonly eventId: EventId
  readonly jobId: JobId
  readonly now: string
}

export type ClaimInput = {
  readonly organizationId: OrganizationId
  readonly jobId: JobId
  readonly workerId: WorkerId
  readonly now: string
  readonly leaseExpiresAt: string
}

export type ScheduleInput = {
  readonly organizationId: OrganizationId
  readonly triggerId: TriggerId
  readonly taskName: string
  readonly targetKey: string
  readonly slotAt: string
  readonly commandId: QueueJob["commandId"]
  readonly createdAt: string
}

export class PostgresDeliveryRepository {
  private readonly executor: PostgresExecutor
  private readonly recovery: PostgresDeliveryRecovery

  constructor(executor: PostgresExecutor) {
    this.executor = executor
    this.recovery = new PostgresDeliveryRecovery(executor)
  }

  dispatchOutbox(input: DispatchInput): Promise<DispatchResult> {
    return this.executor.transaction(async (tx) => {
      const eventRows = await tx.query(statement(
        "dispatch.outbox.lock",
        "SELECT organization_id, event_id, command_id, available_at FROM outbox_events WHERE organization_id = $1 AND event_id = $2 AND dispatched_at IS NULL FOR UPDATE",
        [input.organizationId, input.eventId],
      ))
      const event = eventRows[0]
      if (event === undefined) {
        const existingRows = await tx.query(statement(
          "dispatch.job.by_event",
          `SELECT ${QUEUE_JOB_COLUMNS} FROM queue_jobs WHERE organization_id = $1 AND outbox_event_id = $2`,
          [input.organizationId, input.eventId],
        ))
        if (existingRows.length > 0) return { kind: "duplicate", job: onlyJob(existingRows) }
        throw new DeliveryNotFoundError(input.eventId)
      }
      const insertedRows = await tx.query(statement(
        "dispatch.job.insert",
        `INSERT INTO queue_jobs (organization_id, job_id, command_id, outbox_event_id, state, available_at, created_at)
         VALUES ($1, $2, $3, $4, 'PENDING', $5, $6)
         ON CONFLICT (outbox_event_id) DO NOTHING RETURNING ${QUEUE_JOB_COLUMNS}`,
        [input.organizationId, input.jobId, requiredString(event, "command_id"), input.eventId, requiredString(event, "available_at"), input.now],
      ))
      if (insertedRows.length === 0) {
        const existingRows = await tx.query(statement(
          "dispatch.job.by_event",
          `SELECT ${QUEUE_JOB_COLUMNS} FROM queue_jobs WHERE organization_id = $1 AND outbox_event_id = $2`,
          [input.organizationId, input.eventId],
        ))
        return { kind: "duplicate", job: onlyJob(existingRows) }
      }
      await tx.query(statement(
        "dispatch.outbox.mark_dispatched",
        "UPDATE outbox_events SET dispatched_at = $3 WHERE organization_id = $1 AND event_id = $2",
        [input.organizationId, input.eventId, input.now],
      ))
      return { kind: "dispatched", job: onlyJob(insertedRows) }
    })
  }

  claimJob(input: ClaimInput): Promise<DeliveryDecision> {
    return this.executor.transaction(async (tx) => {
      const leasedRows = await tx.query(statement(
        "claim.job.skip_locked",
        `WITH candidate AS (
           SELECT job_id FROM queue_jobs
           WHERE organization_id = $1 AND job_id = $2
             AND available_at <= $4
             AND (state IN ('PENDING', 'RETRY_SCHEDULED')
               OR (state = 'LEASED' AND lease_expires_at <= $4))
           FOR UPDATE SKIP LOCKED
         )
         UPDATE queue_jobs AS job
         SET state = 'LEASED', attempt_count = job.attempt_count + 1,
             lease_owner = $3, lease_expires_at = $5,
             fencing_generation = job.fencing_generation + 1
         FROM candidate WHERE job.job_id = candidate.job_id
         RETURNING ${QUEUE_JOB_COLUMNS}`,
        [input.organizationId, input.jobId, input.workerId, input.now, input.leaseExpiresAt],
      ))
      if (leasedRows.length > 0) {
        const job = onlyJob(leasedRows)
        return {
          kind: "execute",
          lease: {
            organizationId: job.organizationId,
            jobId: job.jobId,
            workerId: WorkerIdSchema.parse(input.workerId),
            generation: job.fencingGeneration,
          },
        }
      }
      const currentRows = await tx.query(statement(
        "claim.job.current",
        `SELECT ${QUEUE_JOB_COLUMNS} FROM queue_jobs WHERE organization_id = $1 AND job_id = $2`,
        [input.organizationId, input.jobId],
      ))
      const current = onlyJobOrUndefined(currentRows)
      if (current === undefined) throw new DeliveryNotFoundError(input.jobId)
      if (current.state === "COMPLETED" || current.state === "ACKNOWLEDGED" || current.state === "DEAD_LETTERED") {
        return { kind: "terminal_noop", job: current }
      }
      throw new InvalidJobTransitionError(input.jobId, current.state, "be claimed at the requested time")
    })
  }

  commitResult(lease: LeaseToken, completedAt: string): Promise<QueueJob> {
    return this.executor.transaction(async (tx) => {
      const rows = await tx.query(statement(
        "commit.current_fence",
        `UPDATE queue_jobs SET state = 'COMPLETED', completed_at = $5
         WHERE organization_id = $1 AND job_id = $2 AND state = 'LEASED'
           AND lease_owner = $3 AND fencing_generation = $4
         RETURNING ${QUEUE_JOB_COLUMNS}`,
        [lease.organizationId, lease.jobId, lease.workerId, lease.generation, completedAt],
      ))
      if (rows.length === 0) throw new StaleLeaseError(lease.jobId, lease.workerId, lease.generation)
      return onlyJob(rows)
    })
  }

  acknowledge(organizationId: OrganizationId, jobId: JobId, acknowledgedAt: string): Promise<QueueJob> {
    return this.executor.transaction(async (tx) => {
      const rows = await tx.query(statement(
        "ack.completed_only",
        `UPDATE queue_jobs SET state = 'ACKNOWLEDGED', acknowledged_at = $3
         WHERE organization_id = $1 AND job_id = $2 AND state = 'COMPLETED'
         RETURNING ${QUEUE_JOB_COLUMNS}`,
        [organizationId, jobId, acknowledgedAt],
      ))
      if (rows.length > 0) return onlyJob(rows)
      const currentRows = await tx.query(statement(
        "ack.current",
        `SELECT ${QUEUE_JOB_COLUMNS} FROM queue_jobs WHERE organization_id = $1 AND job_id = $2`,
        [organizationId, jobId],
      ))
      const current = onlyJobOrUndefined(currentRows)
      if (current === undefined) throw new DeliveryNotFoundError(jobId)
      throw new InvalidJobTransitionError(jobId, current.state, "acknowledge")
    })
  }

  deadLetter(input: DeadLetterInput): Promise<QueueJob> {
    return this.recovery.deadLetter(input)
  }

  replayDeadLetter(input: ReplayInput): Promise<QueueJob> {
    return this.recovery.replayDeadLetter(input)
  }

  materializeSchedule(input: ScheduleInput): Promise<ScheduleSlotResult> {
    return this.executor.transaction(async (tx) => {
      const rows = await tx.query(statement(
        "schedule.insert_unique_slot",
        `WITH scheduler_lock AS (
           SELECT pg_advisory_xact_lock(hashtextextended(concat_ws(':', $2, $3, $4, $5), 0))
         )
         INSERT INTO scheduled_triggers (trigger_id, organization_id, task_name, target_key, slot_at, command_id, created_at)
         SELECT $1, $2, $3, $4, $5, $6, $7 FROM scheduler_lock
         ON CONFLICT (organization_id, task_name, target_key, slot_at) DO NOTHING RETURNING trigger_id`,
        [input.triggerId, input.organizationId, input.taskName, input.targetKey, input.slotAt, input.commandId, input.createdAt],
      ))
      if (rows.length > 0) return { kind: "created", slotId: TriggerIdSchema.parse(requiredString(rows[0] ?? {}, "trigger_id")) }
      const existing = await tx.query(statement(
        "schedule.find_unique_slot",
        "SELECT trigger_id FROM scheduled_triggers WHERE organization_id = $1 AND task_name = $2 AND target_key = $3 AND slot_at = $4",
        [input.organizationId, input.taskName, input.targetKey, input.slotAt],
      ))
      return { kind: "duplicate", slotId: TriggerIdSchema.parse(requiredString(existing[0] ?? {}, "trigger_id")) }
    })
  }
}
