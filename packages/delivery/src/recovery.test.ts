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
import { InvalidJobTransitionError } from "./errors.ts"
import { InMemoryDeliveryStore } from "./in-memory-delivery.ts"

function poisonStore(): {
  readonly store: InMemoryDeliveryStore
  readonly jobId: ReturnType<typeof JobIdSchema.parse>
  readonly deadLetterId: ReturnType<typeof DeadLetterIdSchema.parse>
} {
  const organizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000002")
  const commandId = CommandIdSchema.parse("20000000-0000-4000-8000-000000000002")
  const eventId = EventIdSchema.parse("30000000-0000-4000-8000-000000000002")
  const jobId = JobIdSchema.parse("40000000-0000-4000-8000-000000000004")
  const store = new InMemoryDeliveryStore()
  store.registerCommand(parseCommandEnvelope({
    organizationId,
    commandId,
    commandType: "poison.command",
    schemaVersion: 1,
    aggregateType: "shop",
    aggregateId: "shop-2",
    dedupeKey: "poison:shop-2",
    createdAt: "2026-09-09T00:00:00.000Z",
    payload: {},
  }))
  store.appendOutbox({
    organizationId,
    eventId,
    eventType: "command.ready",
    schemaVersion: 1,
    commandId,
    aggregateType: "shop",
    aggregateId: "shop-2",
    dedupeKey: "poison:shop-2",
    availableAt: "2026-09-09T00:00:00.000Z",
    createdAt: "2026-09-09T00:00:00.000Z",
  })
  store.dispatchOutbox(eventId, jobId, "2026-09-09T00:00:01.000Z")
  const delivery = store.beginDelivery(
    jobId,
    WorkerIdSchema.parse("worker-poison"),
    "2026-09-09T00:00:02.000Z",
    "2026-09-09T00:00:03.000Z",
  )
  assert.equal(delivery.kind, "execute")
  const deadLetterId = DeadLetterIdSchema.parse("50000000-0000-4000-8000-000000000002")
  store.deadLetter(delivery.lease, deadLetterId, "INVARIANT_FAILURE")
  return { store, jobId, deadLetterId }
}

describe("delivery recovery boundaries", () => {
  it("rejects misleading acknowledgement before result commit", () => {
    // Given: poison work is terminal without a committed successful result.
    const { store, jobId } = poisonStore()

    // When: a caller reports success by attempting acknowledgement.
    const action = (): void => {
      store.acknowledge(jobId, "2026-09-09T00:00:04.000Z")
    }

    // Then: durable state wins over the misleading success signal.
    assert.throws(action, InvalidJobTransitionError)
    assert.equal(store.getJob(jobId)?.state, "DEAD_LETTERED")
  })

  it("deduplicates repeated replay requests for the same dead letter", () => {
    // Given: one immutable poison command and its dead letter.
    const { store, deadLetterId } = poisonStore()
    const firstJobId = JobIdSchema.parse("40000000-0000-4000-8000-000000000005")

    // When: replay is requested twice with different proposed job identities.
    const first = store.replayDeadLetter(deadLetterId, firstJobId, "2026-09-09T01:00:00.000Z")
    const second = store.replayDeadLetter(
      deadLetterId,
      JobIdSchema.parse("40000000-0000-4000-8000-000000000006"),
      "2026-09-09T01:00:01.000Z",
    )

    // Then: both requests resolve to one replay job and one logical command.
    assert.equal(second.jobId, first.jobId)
    assert.equal(second.commandId, first.commandId)
  })
})
