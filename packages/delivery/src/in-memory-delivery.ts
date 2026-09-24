import type {
  CommandEnvelope,
  DeadLetterId,
  EventId,
  JobId,
  OrganizationId,
  WorkerId,
} from "./contracts.ts"
import type {
  DeadLetter,
  DeliveryDecision,
  DispatchResult,
  LeaseToken,
  OutboxEvent,
  QueueJob,
  ScheduleSlotResult,
} from "./delivery-types.ts"
import {
  DeliveryConflictError,
  DeliveryNotFoundError,
  InvalidJobTransitionError,
  StaleLeaseError,
} from "./errors.ts"

export type {
  DeliveryDecision,
  DispatchResult,
  LeaseToken,
  QueueJob,
  QueueJobState,
  ScheduleSlotResult,
} from "./delivery-types.ts"

export class InMemoryDeliveryStore {
  private readonly commands = new Map<CommandEnvelope["commandId"], CommandEnvelope>()
  private readonly commandDedupe = new Map<string, CommandEnvelope["commandId"]>()
  private readonly outbox = new Map<EventId, OutboxEvent>()
  private readonly jobs = new Map<JobId, QueueJob>()
  private readonly jobsByEvent = new Map<EventId, JobId>()
  private readonly scheduleSlots = new Map<string, string>()
  private readonly deadLetters = new Map<DeadLetterId, DeadLetter>()

  registerCommand(command: CommandEnvelope): void {
    const dedupeIdentity = `${command.organizationId}:${command.dedupeKey}`
    const existingCommandId = this.commandDedupe.get(dedupeIdentity)
    if (existingCommandId !== undefined && existingCommandId !== command.commandId) {
      throw new DeliveryConflictError(command.commandId, "trusted dedupe key is already registered")
    }
    const existingCommand = this.commands.get(command.commandId)
    if (existingCommand !== undefined && existingCommand !== command) {
      throw new DeliveryConflictError(command.commandId, "command identity is immutable")
    }
    this.commands.set(command.commandId, command)
    this.commandDedupe.set(dedupeIdentity, command.commandId)
  }

  appendOutbox(event: {
    readonly organizationId: OrganizationId
    readonly eventId: EventId
    readonly eventType: string
    readonly schemaVersion: number
    readonly commandId: CommandEnvelope["commandId"]
    readonly aggregateType: string
    readonly aggregateId: string
    readonly dedupeKey: string
    readonly availableAt: string
    readonly createdAt: string
  }): void {
    const command = this.commands.get(event.commandId)
    if (command === undefined) throw new DeliveryNotFoundError(event.commandId)
    if (command.organizationId !== event.organizationId) {
      throw new DeliveryConflictError(event.commandId, "organization scope does not match command")
    }
    const existingEvent = this.outbox.get(event.eventId)
    if (existingEvent !== undefined) throw new DeliveryConflictError(event.eventId, "event ID is unique")
    this.outbox.set(event.eventId, event)
  }

  dispatchOutbox(eventId: EventId, jobId: JobId, now: string): DispatchResult {
    const existingJobId = this.jobsByEvent.get(eventId)
    if (existingJobId !== undefined) {
      const existingJob = this.jobs.get(existingJobId)
      if (existingJob === undefined) throw new DeliveryNotFoundError(existingJobId)
      return { kind: "duplicate", job: existingJob }
    }
    if (this.jobs.has(jobId)) throw new DeliveryConflictError(jobId, "job ID is unique")
    const event = this.outbox.get(eventId)
    if (event === undefined) throw new DeliveryNotFoundError(eventId)
    const job: QueueJob = {
      organizationId: event.organizationId,
      jobId,
      commandId: event.commandId,
      outboxEventId: eventId,
      state: "PENDING",
      availableAt: event.availableAt,
      attemptCount: 0,
      fencingGeneration: 0,
    }
    this.jobs.set(jobId, job)
    this.jobsByEvent.set(eventId, jobId)
    this.outbox.set(eventId, { ...event, dispatchedAt: now })
    return { kind: "dispatched", job }
  }

  materializeSchedule(input: {
    readonly organizationId: OrganizationId
    readonly taskName: string
    readonly targetKey: string
    readonly slot: string
  }): ScheduleSlotResult {
    const identity = `${input.organizationId}:${input.taskName}:${input.targetKey}:${input.slot}`
    const existingSlotId = this.scheduleSlots.get(identity)
    if (existingSlotId !== undefined) return { kind: "duplicate", slotId: existingSlotId }
    this.scheduleSlots.set(identity, identity)
    return { kind: "created", slotId: identity }
  }

  beginDelivery(
    jobId: JobId,
    workerId: WorkerId,
    now: string,
    leaseExpiresAt: string,
  ): DeliveryDecision {
    const job = this.jobs.get(jobId)
    if (job === undefined) throw new DeliveryNotFoundError(jobId)
    if (job.state === "COMPLETED" || job.state === "ACKNOWLEDGED" || job.state === "DEAD_LETTERED") {
      return { kind: "terminal_noop", job }
    }
    if (job.state === "LEASED" && job.leaseExpiresAt !== undefined && job.leaseExpiresAt > now) {
      throw new InvalidJobTransitionError(jobId, job.state, "be claimed before lease expiry")
    }
    if (job.availableAt > now) {
      throw new InvalidJobTransitionError(jobId, job.state, "be claimed before availability")
    }
    const leasedJob: QueueJob = {
      ...job,
      state: "LEASED",
      attemptCount: job.attemptCount + 1,
      leaseOwner: workerId,
      leaseExpiresAt,
      fencingGeneration: job.fencingGeneration + 1,
    }
    this.jobs.set(jobId, leasedJob)
    return {
      kind: "execute",
      lease: {
        organizationId: leasedJob.organizationId,
        jobId,
        workerId,
        generation: leasedJob.fencingGeneration,
      },
    }
  }

  commitResult(lease: LeaseToken, completedAt: string): QueueJob {
    const job = this.requireActiveLease(lease)
    const completedJob: QueueJob = {
      ...job,
      state: "COMPLETED",
      completedAt,
    }
    this.jobs.set(job.jobId, completedJob)
    return completedJob
  }

  acknowledge(jobId: JobId, acknowledgedAt: string): QueueJob {
    const job = this.jobs.get(jobId)
    if (job === undefined) throw new DeliveryNotFoundError(jobId)
    if (job.state !== "COMPLETED") {
      throw new InvalidJobTransitionError(jobId, job.state, "acknowledge")
    }
    const acknowledgedJob: QueueJob = { ...job, state: "ACKNOWLEDGED", acknowledgedAt }
    this.jobs.set(jobId, acknowledgedJob)
    return acknowledgedJob
  }

  deadLetter(lease: LeaseToken, deadLetterId: DeadLetterId, reasonCode: string): QueueJob {
    const job = this.requireActiveLease(lease)
    if (this.deadLetters.has(deadLetterId)) {
      throw new DeliveryConflictError(deadLetterId, "dead-letter ID is unique")
    }
    const deadLetteredJob: QueueJob = { ...job, state: "DEAD_LETTERED" }
    this.jobs.set(job.jobId, deadLetteredJob)
    this.deadLetters.set(deadLetterId, {
      deadLetterId,
      organizationId: job.organizationId,
      sourceJobId: job.jobId,
      commandId: job.commandId,
      reasonCode,
      fencingGeneration: lease.generation,
    })
    return deadLetteredJob
  }

  replayDeadLetter(deadLetterId: DeadLetterId, newJobId: JobId, availableAt: string): QueueJob {
    const deadLetter = this.deadLetters.get(deadLetterId)
    if (deadLetter === undefined) throw new DeliveryNotFoundError(deadLetterId)
    if (deadLetter.replayJobId !== undefined) {
      const replayJob = this.jobs.get(deadLetter.replayJobId)
      if (replayJob === undefined) throw new DeliveryNotFoundError(deadLetter.replayJobId)
      return replayJob
    }
    if (this.jobs.has(newJobId)) throw new DeliveryConflictError(newJobId, "job ID is unique")
    const replayJob: QueueJob = {
      organizationId: deadLetter.organizationId,
      jobId: newJobId,
      commandId: deadLetter.commandId,
      replayOfDeadLetterId: deadLetterId,
      state: "PENDING",
      availableAt,
      attemptCount: 0,
      fencingGeneration: 0,
    }
    this.jobs.set(newJobId, replayJob)
    this.deadLetters.set(deadLetterId, { ...deadLetter, replayJobId: newJobId })
    return replayJob
  }

  getJob(jobId: JobId): QueueJob | undefined {
    return this.jobs.get(jobId)
  }

  private requireActiveLease(lease: LeaseToken): QueueJob {
    const job = this.jobs.get(lease.jobId)
    if (job === undefined) throw new DeliveryNotFoundError(lease.jobId)
    if (
      job.state !== "LEASED" ||
      job.leaseOwner !== lease.workerId ||
      job.fencingGeneration !== lease.generation
    ) {
      throw new StaleLeaseError(lease.jobId, lease.workerId, lease.generation)
    }
    return job
  }
}
