import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import {
  CommandIdSchema,
  DeadLetterIdSchema,
  EventIdSchema,
  JobIdSchema,
  OrganizationIdSchema,
  TriggerIdSchema,
  WorkerIdSchema,
} from "./contracts.ts"
import { DeliveryNotFoundError, InvalidJobTransitionError } from "./errors.ts"
import { FakePostgresExecutor, outboxRow } from "./postgres-delivery.fake.ts"
import { PostgresDeliveryRepository } from "./postgres-delivery.ts"

const organizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000021")
const otherOrganizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000022")
const commandId = CommandIdSchema.parse("20000000-0000-4000-8000-000000000021")
const eventId = EventIdSchema.parse("30000000-0000-4000-8000-000000000021")
const jobId = JobIdSchema.parse("40000000-0000-4000-8000-000000000021")
const workerA = WorkerIdSchema.parse("postgres-worker-a")
const workerB = WorkerIdSchema.parse("postgres-worker-b")

function seeded(): FakePostgresExecutor {
  const executor = new FakePostgresExecutor()
  executor.seedOutbox(outboxRow({ organizationId, eventId, commandId }))
  return executor
}

describe("PostgreSQL delivery contract", () => {
  it("atomically dispatches an outbox event once", async () => {
    const executor = seeded()
    const repository = new PostgresDeliveryRepository(executor)
    const input = { organizationId, eventId, jobId, now: "2026-09-09T02:00:00.000Z" }

    const first = await repository.dispatchOutbox(input)
    const second = await repository.dispatchOutbox({ ...input, jobId: JobIdSchema.parse("40000000-0000-4000-8000-000000000022") })

    assert.equal(first.kind, "dispatched")
    assert.equal(second.kind, "duplicate")
    assert.equal(second.job.jobId, jobId)
    assert.equal(executor.countJobs(), 1)
    assert.equal(executor.statementsFor("dispatch.outbox.lock").length, 2)
    assert.match(executor.statementsFor("dispatch.job.insert")[0]?.text ?? "", /ON CONFLICT \(outbox_event_id\) DO NOTHING/)
    await assert.rejects(repository.dispatchOutbox({ ...input, organizationId: otherOrganizationId }), DeliveryNotFoundError)
  })

  it("rejects a live lease and reclaims it only after the current time", async () => {
    const executor = seeded()
    const repository = new PostgresDeliveryRepository(executor)
    await repository.dispatchOutbox({ organizationId, eventId, jobId, now: "2026-09-09T02:00:00.000Z" })
    const first = await repository.claimJob({
      organizationId,
      jobId,
      workerId: workerA,
      now: "2026-09-09T02:00:01.000Z",
      leaseExpiresAt: "2026-09-09T02:00:03.000Z",
    })
    assert.equal(first.kind, "execute")

    await assert.rejects(
      repository.claimJob({
        organizationId,
        jobId,
        workerId: workerB,
        now: "2026-09-09T02:00:02.000Z",
        leaseExpiresAt: "2026-09-09T02:00:04.000Z",
      }),
      InvalidJobTransitionError,
    )
    const recovered = await repository.claimJob({
      organizationId,
      jobId,
      workerId: workerB,
      now: "2026-09-09T02:00:04.000Z",
      leaseExpiresAt: "2026-09-09T02:00:05.000Z",
    })

    assert.equal(recovered.kind, "execute")
    assert.equal(recovered.lease.generation, 2)
    assert.match(executor.statementsFor("claim.job.skip_locked")[0]?.text ?? "", /FOR UPDATE SKIP LOCKED/)
  })

  it("keeps organization and dedupe uniqueness in the migration contract", () => {
    const migration = readFileSync(new URL("../../../db/migrations/0002_delivery.sql", import.meta.url), "utf8")

    assert.match(migration, /UNIQUE \(organization_id, dedupe_key\)/)
    assert.match(migration, /UNIQUE \(organization_id, job_id\)/)
    assert.match(migration, /UNIQUE \(organization_id, task_name, target_key, slot_at\)/)
    assert.match(migration, /FOREIGN KEY \(organization_id, command_id\)/)
  })

  it("deduplicates a scheduler slot by its UUID trigger identity", async () => {
    const executor = seeded()
    const repository = new PostgresDeliveryRepository(executor)
    const triggerId = TriggerIdSchema.parse("60000000-0000-4000-8000-000000000021")
    const input = {
      organizationId,
      triggerId,
      taskName: "catalog-sync",
      targetKey: "shop-21",
      slotAt: "2026-09-09T02:00:00.000Z",
      commandId,
      createdAt: "2026-09-09T02:00:00.000Z",
    }

    const first = await repository.materializeSchedule(input)
    const second = await repository.materializeSchedule({ ...input, triggerId: TriggerIdSchema.parse("60000000-0000-4000-8000-000000000022") })

    assert.deepEqual(first, { kind: "created", slotId: triggerId })
    assert.deepEqual(second, { kind: "duplicate", slotId: triggerId })
  })

  it("replays a dead letter once without changing the command", async () => {
    const executor = seeded()
    const repository = new PostgresDeliveryRepository(executor)
    await repository.dispatchOutbox({ organizationId, eventId, jobId, now: "2026-09-09T02:00:00.000Z" })
    const lease = await repository.claimJob({
      organizationId,
      jobId,
      workerId: workerA,
      now: "2026-09-09T02:00:01.000Z",
      leaseExpiresAt: "2026-09-09T02:00:02.000Z",
    })
    assert.equal(lease.kind, "execute")
    const deadLetterId = DeadLetterIdSchema.parse("50000000-0000-4000-8000-000000000021")
    await repository.deadLetter({
      lease: lease.lease,
      deadLetterId,
      reasonCode: "UNSUPPORTED_SCHEMA_VERSION",
      createdAt: "2026-09-09T02:00:03.000Z",
    })

    const first = await repository.replayDeadLetter({
      organizationId,
      deadLetterId,
      jobId: JobIdSchema.parse("40000000-0000-4000-8000-000000000023"),
      availableAt: "2026-09-09T03:00:00.000Z",
      createdAt: "2026-09-09T03:00:00.000Z",
    })
    const second = await repository.replayDeadLetter({
      organizationId,
      deadLetterId,
      jobId: JobIdSchema.parse("40000000-0000-4000-8000-000000000024"),
      availableAt: "2026-09-09T03:00:01.000Z",
      createdAt: "2026-09-09T03:00:01.000Z",
    })

    assert.equal(first.jobId, second.jobId)
    assert.equal(first.commandId, commandId)
    assert.equal(first.replayOfDeadLetterId, deadLetterId)
  })
})
