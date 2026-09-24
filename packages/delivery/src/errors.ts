import type { CommandId, DeadLetterId, EventId, JobId, WorkerId } from "./contracts.ts"

export class StaleLeaseError extends Error {
  readonly name = "StaleLeaseError"
  readonly jobId: JobId
  readonly workerId: WorkerId
  readonly generation: number

  constructor(jobId: JobId, workerId: WorkerId, generation: number) {
    super(`Lease is stale for job ${jobId}`)
    this.jobId = jobId
    this.workerId = workerId
    this.generation = generation
  }
}

export class DeliveryConflictError extends Error {
  readonly name = "DeliveryConflictError"

  constructor(readonlyKey: CommandId | EventId | JobId | DeadLetterId, reason: string) {
    super(`Delivery conflict for ${readonlyKey}: ${reason}`)
  }
}

export class DeliveryNotFoundError extends Error {
  readonly name = "DeliveryNotFoundError"

  constructor(readonlyKey: CommandId | EventId | JobId | DeadLetterId) {
    super(`Delivery record ${readonlyKey} was not found`)
  }
}

export class InvalidJobTransitionError extends Error {
  readonly name = "InvalidJobTransitionError"

  constructor(jobId: JobId, state: string, transition: string) {
    super(`Job ${jobId} cannot ${transition} from ${state}`)
  }
}
