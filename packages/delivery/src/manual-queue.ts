import { z } from "zod"
import {
  CommandIdSchema,
  DeadLetterIdSchema,
  EventIdSchema,
  JobIdSchema,
  OrganizationIdSchema,
  WorkerIdSchema,
  parseCommandEnvelope,
} from "./contracts.ts"
import { InvalidJobTransitionError, StaleLeaseError } from "./errors.ts"
import { InMemoryDeliveryStore } from "./in-memory-delivery.ts"

const organizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000010")
const commandId = CommandIdSchema.parse("20000000-0000-4000-8000-000000000010")
const eventId = EventIdSchema.parse("30000000-0000-4000-8000-000000000010")
const jobId = JobIdSchema.parse("40000000-0000-4000-8000-000000000010")
const workerA = WorkerIdSchema.parse("manual-worker-a")
const workerB = WorkerIdSchema.parse("manual-worker-b")
const store = new InMemoryDeliveryStore()
const transitions: Array<{ readonly step: string; readonly observable: string }> = []

let malformedInput = "unexpected_acceptance"
try {
  parseCommandEnvelope({ commandId: "client-controlled-hash" })
} catch (error) {
  if (error instanceof z.ZodError) malformedInput = "rejected"
  else throw error
}

const command = parseCommandEnvelope({
  organizationId,
  commandId,
  commandType: "catalog.sync",
  schemaVersion: 1,
  aggregateType: "shop",
  aggregateId: "shop-manual",
  dedupeKey: "catalog.sync:shop-manual:slot-manual",
  createdAt: "2026-09-09T00:00:00.000Z",
  payload: { shopId: "shop-manual" },
})
store.registerCommand(command)
store.appendOutbox({
  organizationId,
  eventId,
  eventType: "command.ready",
  schemaVersion: 1,
  commandId,
  aggregateType: "shop",
  aggregateId: "shop-manual",
  dedupeKey: "catalog.sync:shop-manual:slot-manual",
  availableAt: "2026-09-09T00:00:00.000Z",
  createdAt: "2026-09-09T00:00:00.000Z",
})

const dispatched = store.dispatchOutbox(eventId, jobId, "2026-09-09T00:00:01.000Z")
transitions.push({ step: "outbox_dispatch", observable: dispatched.job.state })
const duplicate = store.dispatchOutbox(
  eventId,
  JobIdSchema.parse("40000000-0000-4000-8000-000000000011"),
  "2026-09-09T00:00:02.000Z",
)
transitions.push({ step: "duplicate_dispatch", observable: `${duplicate.kind}:${duplicate.job.jobId}` })

const firstLease = store.beginDelivery(
  jobId,
  workerA,
  "2026-09-09T00:00:03.000Z",
  "2026-09-09T00:00:04.000Z",
)
if (firstLease.kind !== "execute") throw new InvalidJobTransitionError(jobId, "PENDING", "execute")
transitions.push({ step: "first_claim", observable: `generation:${firstLease.lease.generation}` })

const reclaimedLease = store.beginDelivery(
  jobId,
  workerB,
  "2026-09-09T00:00:05.000Z",
  "2026-09-09T00:00:06.000Z",
)
if (reclaimedLease.kind !== "execute") throw new InvalidJobTransitionError(jobId, "LEASED", "reclaim")
transitions.push({ step: "expired_lease_reclaim", observable: `generation:${reclaimedLease.lease.generation}` })
transitions.push({ step: "interruption_recovery", observable: `reclaimed:${reclaimedLease.lease.workerId}` })

let staleLease = "unexpected_commit"
try {
  store.commitResult(firstLease.lease, "2026-09-09T00:00:05.500Z")
} catch (error) {
  if (error instanceof StaleLeaseError) staleLease = "rejected"
  else throw error
}
transitions.push({ step: "stale_lease_commit", observable: staleLease })

let misleadingSuccess = "unexpected_acknowledgement"
try {
  store.acknowledge(jobId, "2026-09-09T00:00:05.600Z")
} catch (error) {
  if (error instanceof InvalidJobTransitionError) misleadingSuccess = "rejected"
  else throw error
}
transitions.push({ step: "ack_before_commit", observable: misleadingSuccess })

const completed = store.commitResult(reclaimedLease.lease, "2026-09-09T00:00:05.700Z")
transitions.push({ step: "commit_before_ack", observable: completed.state })
const redelivery = store.beginDelivery(
  jobId,
  workerA,
  "2026-09-09T00:00:07.000Z",
  "2026-09-09T00:00:08.000Z",
)
transitions.push({ step: "lost_ack_redelivery", observable: redelivery.kind })
const acknowledged = store.acknowledge(jobId, "2026-09-09T00:00:07.100Z")
transitions.push({ step: "ack_after_commit", observable: acknowledged.state })

const slotInput = {
  organizationId,
  taskName: "catalog-sync",
  targetKey: "shop-manual",
  slot: "2026-09-09T00:00Z",
}
const slotFirst = store.materializeSchedule(slotInput)
const slotSecond = store.materializeSchedule(slotInput)
transitions.push({ step: "scheduler_collision", observable: `${slotFirst.kind}:${slotSecond.kind}` })

const poisonStore = new InMemoryDeliveryStore()
const poisonCommandId = CommandIdSchema.parse("20000000-0000-4000-8000-000000000012")
const poisonEventId = EventIdSchema.parse("30000000-0000-4000-8000-000000000012")
const poisonJobId = JobIdSchema.parse("40000000-0000-4000-8000-000000000012")
poisonStore.registerCommand(parseCommandEnvelope({
  ...command,
  commandId: poisonCommandId,
  commandType: "poison.command",
  dedupeKey: "poison:manual",
}))
poisonStore.appendOutbox({
  organizationId,
  eventId: poisonEventId,
  eventType: "command.ready",
  schemaVersion: 1,
  commandId: poisonCommandId,
  aggregateType: "shop",
  aggregateId: "shop-manual",
  dedupeKey: "poison:manual",
  availableAt: "2026-09-09T00:00:00.000Z",
  createdAt: "2026-09-09T00:00:00.000Z",
})
poisonStore.dispatchOutbox(poisonEventId, poisonJobId, "2026-09-09T00:00:01.000Z")
const poisonLease = poisonStore.beginDelivery(
  poisonJobId,
  workerA,
  "2026-09-09T00:00:02.000Z",
  "2026-09-09T00:00:03.000Z",
)
if (poisonLease.kind !== "execute") {
  throw new InvalidJobTransitionError(poisonJobId, "PENDING", "execute")
}
const deadLetterId = DeadLetterIdSchema.parse("50000000-0000-4000-8000-000000000010")
poisonStore.deadLetter(poisonLease.lease, deadLetterId, "UNSUPPORTED_SCHEMA_VERSION")
const replayJobId = JobIdSchema.parse("40000000-0000-4000-8000-000000000013")
const replay = poisonStore.replayDeadLetter(deadLetterId, replayJobId, "2026-09-09T01:00:00.000Z")
const repeatedReplay = poisonStore.replayDeadLetter(
  deadLetterId,
  JobIdSchema.parse("40000000-0000-4000-8000-000000000014"),
  "2026-09-09T01:00:01.000Z",
)
transitions.push({
  step: "poison_replay",
  observable: `${replay.state}:${replay.jobId === repeatedReplay.jobId}:${replay.commandId}`,
})

process.stdout.write(`${JSON.stringify({
  semantics: "at-least-once",
  malformedInput,
  transitions,
  cleanup: "process-local stores discarded on exit",
}, null, 2)}\n`)
