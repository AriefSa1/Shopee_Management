import { DeliveryNotFoundError, StaleLeaseError } from "./errors.ts"
import type { LeaseToken, QueueJob } from "./delivery-types.ts"
import type { DeadLetterId, JobId } from "./contracts.ts"
import {
  onlyJob,
  QUEUE_JOB_COLUMNS,
  requiredString,
  statement,
} from "./postgres-delivery-mappers.ts"
import type { PostgresExecutor } from "./postgres-delivery.ts"

export type DeadLetterInput = {
  readonly lease: LeaseToken
  readonly deadLetterId: DeadLetterId
  readonly reasonCode: string
  readonly createdAt: string
}

export type ReplayInput = {
  readonly organizationId: LeaseToken["organizationId"]
  readonly deadLetterId: DeadLetterId
  readonly jobId: JobId
  readonly availableAt: string
  readonly createdAt: string
}

export class PostgresDeliveryRecovery {
  private readonly executor: PostgresExecutor

  constructor(executor: PostgresExecutor) {
    this.executor = executor
  }

  deadLetter(input: DeadLetterInput): Promise<QueueJob> {
    return this.executor.transaction(async (tx) => {
      const rows = await tx.query(statement(
        "dead_letter.fence_job",
        `UPDATE queue_jobs SET state = 'DEAD_LETTERED'
         WHERE organization_id = $1 AND job_id = $2 AND state = 'LEASED'
           AND lease_owner = $3 AND fencing_generation = $4
         RETURNING ${QUEUE_JOB_COLUMNS}`,
        [input.lease.organizationId, input.lease.jobId, input.lease.workerId, input.lease.generation],
      ))
      if (rows.length === 0) throw new StaleLeaseError(input.lease.jobId, input.lease.workerId, input.lease.generation)
      const job = onlyJob(rows)
      await tx.query(statement(
        "dead_letter.insert",
        `INSERT INTO dead_letter_jobs
           (dead_letter_id, organization_id, source_job_id, command_id, reason_code, fencing_generation, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [input.deadLetterId, input.lease.organizationId, input.lease.jobId, job.commandId, input.reasonCode, input.lease.generation, input.createdAt],
      ))
      return job
    })
  }

  replayDeadLetter(input: ReplayInput): Promise<QueueJob> {
    return this.executor.transaction(async (tx) => {
      const deadLetterRows = await tx.query(statement(
        "replay.dead_letter.lock",
        "SELECT organization_id, command_id FROM dead_letter_jobs WHERE organization_id = $1 AND dead_letter_id = $2 FOR UPDATE",
        [input.organizationId, input.deadLetterId],
      ))
      const deadLetter = deadLetterRows[0]
      if (deadLetter === undefined) throw new DeliveryNotFoundError(input.deadLetterId)
      const existingRows = await tx.query(statement(
        "replay.job.by_dead_letter",
        `SELECT ${QUEUE_JOB_COLUMNS} FROM queue_jobs WHERE organization_id = $1 AND replay_of_dead_letter_id = $2`,
        [input.organizationId, input.deadLetterId],
      ))
      if (existingRows.length > 0) return onlyJob(existingRows)
      const insertedRows = await tx.query(statement(
        "replay.job.insert",
        `INSERT INTO queue_jobs (organization_id, job_id, command_id, replay_of_dead_letter_id, state, available_at, created_at)
         VALUES ($1, $2, $3, $4, 'PENDING', $5, $6)
         ON CONFLICT (replay_of_dead_letter_id) DO NOTHING RETURNING ${QUEUE_JOB_COLUMNS}`,
        [input.organizationId, input.jobId, requiredString(deadLetter, "command_id"), input.deadLetterId, input.availableAt, input.createdAt],
      ))
      if (insertedRows.length > 0) return onlyJob(insertedRows)
      const replayedRows = await tx.query(statement(
        "replay.job.by_dead_letter",
        `SELECT ${QUEUE_JOB_COLUMNS} FROM queue_jobs WHERE organization_id = $1 AND replay_of_dead_letter_id = $2`,
        [input.organizationId, input.deadLetterId],
      ))
      return onlyJob(replayedRows)
    })
  }
}
