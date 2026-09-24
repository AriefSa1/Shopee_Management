import type {
  CommandEnvelope,
  DeadLetterId,
  EventId,
  JobId,
  OrganizationId,
  WorkerId,
} from "./contracts.ts"

export type LeaseToken = {
  readonly organizationId: OrganizationId
  readonly jobId: JobId
  readonly workerId: WorkerId
  readonly generation: number
}

export type QueueJobState =
  | "PENDING"
  | "LEASED"
  | "COMPLETED"
  | "ACKNOWLEDGED"
  | "RETRY_SCHEDULED"
  | "DEAD_LETTERED"

export type QueueJob = {
  readonly organizationId: OrganizationId
  readonly jobId: JobId
  readonly commandId: CommandEnvelope["commandId"]
  readonly outboxEventId?: EventId
  readonly replayOfDeadLetterId?: DeadLetterId
  readonly state: QueueJobState
  readonly availableAt: string
  readonly attemptCount: number
  readonly leaseOwner?: WorkerId
  readonly leaseExpiresAt?: string
  readonly fencingGeneration: number
  readonly completedAt?: string
  readonly acknowledgedAt?: string
}

export type DispatchResult =
  | { readonly kind: "dispatched"; readonly job: QueueJob }
  | { readonly kind: "duplicate"; readonly job: QueueJob }

export type DeliveryDecision =
  | { readonly kind: "execute"; readonly lease: LeaseToken }
  | { readonly kind: "terminal_noop"; readonly job: QueueJob }

export type ScheduleSlotResult =
  | { readonly kind: "created"; readonly slotId: string }
  | { readonly kind: "duplicate"; readonly slotId: string }

export type OutboxEvent = {
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
  readonly dispatchedAt?: string
}

export type DeadLetter = {
  readonly deadLetterId: DeadLetterId
  readonly organizationId: OrganizationId
  readonly sourceJobId: JobId
  readonly commandId: CommandEnvelope["commandId"]
  readonly reasonCode: string
  readonly fencingGeneration: number
  readonly replayJobId?: JobId
}
