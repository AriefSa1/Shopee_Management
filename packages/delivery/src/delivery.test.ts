import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  CommandIdSchema,
  DeadLetterIdSchema,
  EventIdSchema,
  JobIdSchema,
  OrganizationIdSchema,
  WorkerIdSchema,
  parseCommandEnvelope,
} from "./contracts.ts"
import { StaleLeaseError } from "./errors.ts"
import { InMemoryDeliveryStore } from "./in-memory-delivery.ts"

const organizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
const commandId = CommandIdSchema.parse("20000000-0000-4000-8000-000000000001")
const eventId = EventIdSchema.parse("30000000-0000-4000-8000-000000000001")
const jobId = JobIdSchema.parse("40000000-0000-4000-8000-000000000001")
const workerA = WorkerIdSchema.parse("worker-a")
const workerB = WorkerIdSchema.parse("worker-b")

function seededStore(): InMemoryDeliveryStore {
  const store = new InMemoryDeliveryStore()
  store.registerCommand(
    parseCommandEnvelope({
      organizationId,
      commandId,
      commandType: "catalog.sync",
      schemaVersion: 1,
      aggregateType: "shop",
      aggregateId: "shop-1",
      dedupeKey: "catalog.sync:shop-1:slot-1",
      createdAt: "2026-09-09T00:00:00.000Z",
      payload: { shopId: "shop-1" },
    }),
  )
  store.appendOutbox({
    organizationId,
    eventId,
    eventType: "command.ready",
    schemaVersion: 1,
    commandId,
    aggregateType: "shop",
    aggregateId: "shop-1",
    dedupeKey: "catalog.sync:shop-1:slot-1",
    availableAt: "2026-09-09T00:00:00.000Z",
    createdAt: "2026-09-09T00:00:00.000Z",
  })
  return store
}

describe("PostgreSQL-first delivery reference", () => {
  it("prevents a duplicate queue job when an outbox event is dispatched twice", () => {
    // Given: one immutable command and one pending outbox event.
    const store = seededStore()

    // When: the dispatcher scans the same event twice with different proposed job IDs.
    const first = store.dispatchOutbox(eventId, jobId, "2026-09-09T00:00:01.000Z")
    const second = store.dispatchOutbox(
      eventId,
      JobIdSchema.parse("40000000-0000-4000-8000-000000000002"),
      "2026-09-09T00:00:02.000Z",
    )

    // Then: the second scan resolves to the first durable queue job.
    assert.equal(first.kind, "dispatched")
    assert.equal(second.kind, "duplicate")
    assert.equal(second.job.jobId, jobId)
  })

  it("rejects a stale lease generation after an expired lease is reclaimed", () => {
    // Given: worker A claimed a job whose lease then expired.
    const store = seededStore()
    store.dispatchOutbox(eventId, jobId, "2026-09-09T00:00:01.000Z")
    const first = store.beginDelivery(
      jobId,
      workerA,
      "2026-09-09T00:00:02.000Z",
      "2026-09-09T00:00:03.000Z",
    )
    assert.equal(first.kind, "execute")
    const second = store.beginDelivery(
      jobId,
      workerB,
      "2026-09-09T00:00:04.000Z",
      "2026-09-09T00:00:05.000Z",
    )
    assert.equal(second.kind, "execute")

    // When: stale worker A tries to commit with its old fencing generation.
    const action = (): void => {
      store.commitResult(first.lease, "2026-09-09T00:00:04.500Z")
    }

    // Then: the stale commit is rejected and worker B remains the active lease holder.
    assert.throws(action, StaleLeaseError)
    assert.equal(store.getJob(jobId)?.leaseOwner, workerB)
  })

  it("recovers an interrupted worker after its lease expires", () => {
    const store = seededStore()
    store.dispatchOutbox(eventId, jobId, "2026-09-09T00:00:01.000Z")
    const interrupted = store.beginDelivery(
      jobId,
      workerA,
      "2026-09-09T00:00:02.000Z",
      "2026-09-09T00:00:03.000Z",
    )
    assert.equal(interrupted.kind, "execute")

    const recovered = store.beginDelivery(
      jobId,
      workerB,
      "2026-09-09T00:00:04.000Z",
      "2026-09-09T00:00:05.000Z",
    )
    assert.equal(recovered.kind, "execute")
    const completed = store.commitResult(recovered.lease, "2026-09-09T00:00:04.500Z")

    assert.equal(completed.state, "COMPLETED")
    assert.equal(completed.leaseOwner, workerB)
    assert.equal(completed.attemptCount, 2)
  })

  it("does not execute a completed command again after acknowledgement is lost", () => {
    // Given: a worker committed its result but crashed before acknowledgement.
    const store = seededStore()
    store.dispatchOutbox(eventId, jobId, "2026-09-09T00:00:01.000Z")
    const first = store.beginDelivery(
      jobId,
      workerA,
      "2026-09-09T00:00:02.000Z",
      "2026-09-09T00:00:03.000Z",
    )
    assert.equal(first.kind, "execute")
    store.commitResult(first.lease, "2026-09-09T00:00:02.500Z")

    // When: delivery is attempted again after the lease window.
    const redelivery = store.beginDelivery(
      jobId,
      workerB,
      "2026-09-09T00:00:04.000Z",
      "2026-09-09T00:00:05.000Z",
    )

    // Then: the durable terminal state prevents a second command execution.
    assert.equal(redelivery.kind, "terminal_noop")
    assert.equal(redelivery.job.state, "COMPLETED")
    assert.equal(redelivery.job.acknowledgedAt, undefined)
  })

  it("deduplicates a scheduler task by organization, task, target, and slot", () => {
    // Given: a deterministic scheduler slot identity.
    const store = new InMemoryDeliveryStore()
    const input = { organizationId, taskName: "catalog-sync", targetKey: "shop-1", slot: "2026-09-09T00:00Z" }

    // When: two scheduler passes materialize the same slot.
    const first = store.materializeSchedule(input)
    const second = store.materializeSchedule(input)

    // Then: only one slot identity is created.
    assert.equal(first.kind, "created")
    assert.equal(second.kind, "duplicate")
    assert.equal(second.slotId, first.slotId)
  })

  it("replays poison work as a new job referencing the immutable command and dead letter", () => {
    // Given: a leased job moved to dead letter due to a poison schema.
    const store = seededStore()
    store.dispatchOutbox(eventId, jobId, "2026-09-09T00:00:01.000Z")
    const delivery = store.beginDelivery(
      jobId,
      workerA,
      "2026-09-09T00:00:02.000Z",
      "2026-09-09T00:00:03.000Z",
    )
    assert.equal(delivery.kind, "execute")
    const deadLetterId = DeadLetterIdSchema.parse("50000000-0000-4000-8000-000000000001")
    store.deadLetter(delivery.lease, deadLetterId, "UNSUPPORTED_SCHEMA_VERSION")

    // When: an authorized operator replays the dead letter with a new job identity.
    const replayJobId = JobIdSchema.parse("40000000-0000-4000-8000-000000000003")
    const replay = store.replayDeadLetter(
      deadLetterId,
      replayJobId,
      "2026-09-09T01:00:00.000Z",
    )

    // Then: replay does not mutate or replace the immutable command.
    assert.equal(replay.jobId, replayJobId)
    assert.equal(replay.commandId, commandId)
    assert.equal(replay.replayOfDeadLetterId, deadLetterId)
    assert.equal(replay.state, "PENDING")
  })
})
