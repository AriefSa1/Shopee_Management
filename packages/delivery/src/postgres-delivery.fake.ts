import {
  CommandIdSchema,
  EventIdSchema,
  JobIdSchema,
  OrganizationIdSchema,
  type CommandId,
  type EventId,
  type JobId,
  type OrganizationId,
} from "./contracts.ts"
import type { PostgresExecutor, SqlRow, SqlStatement } from "./postgres-delivery.ts"

type StoredRows = {
  readonly outbox: Map<string, SqlRow>
  readonly jobs: Map<string, SqlRow>
  readonly deadLetters: Map<string, SqlRow>
  readonly schedules: Map<string, SqlRow>
}

function key(organizationId: string, value: string): string {
  return `${organizationId}:${value}`
}

function stringParam(statement: SqlStatement, index: number): string {
  const value = statement.params[index]
  if (typeof value !== "string") throw new Error(`Expected string parameter at ${index}`)
  return value
}

function dateNotAfter(left: string, right: string): boolean {
  return left <= right
}

export function outboxRow(input: {
  readonly organizationId: OrganizationId
  readonly eventId: EventId
  readonly commandId: CommandId
}): SqlRow {
  return {
    organization_id: input.organizationId,
    event_id: input.eventId,
    command_id: input.commandId,
    available_at: "2026-09-09T00:00:00.000Z",
    dispatched_at: null,
  }
}

export function jobRow(input: {
  readonly organizationId: OrganizationId
  readonly jobId: JobId
  readonly commandId: CommandId
  readonly state?: string
  readonly outboxEventId?: EventId
  readonly replayOfDeadLetterId?: string
  readonly availableAt?: string
  readonly attemptCount?: number
  readonly leaseOwner?: string
  readonly leaseExpiresAt?: string
  readonly fencingGeneration?: number
}): SqlRow {
  return {
    organization_id: input.organizationId,
    job_id: input.jobId,
    command_id: input.commandId,
    outbox_event_id: input.outboxEventId ?? null,
    replay_of_dead_letter_id: input.replayOfDeadLetterId ?? null,
    state: input.state ?? "PENDING",
    available_at: input.availableAt ?? "2026-09-09T00:00:00.000Z",
    attempt_count: input.attemptCount ?? 0,
    lease_owner: input.leaseOwner ?? null,
    lease_expires_at: input.leaseExpiresAt ?? null,
    fencing_generation: input.fencingGeneration ?? 0,
    completed_at: null,
    acknowledged_at: null,
  }
}

function cloneRows(rows: Map<string, SqlRow>): Map<string, SqlRow> {
  return new Map(rows)
}

export class FakePostgresExecutor implements PostgresExecutor {
  readonly statements: SqlStatement[] = []
  private readonly state: StoredRows

  constructor(state?: StoredRows) {
    this.state = state ?? {
      outbox: new Map(),
      jobs: new Map(),
      deadLetters: new Map(),
      schedules: new Map(),
    }
  }

  seedOutbox(row: SqlRow): void {
    this.state.outbox.set(key(String(row.organization_id), String(row.event_id)), row)
  }

  seedJob(row: SqlRow): void {
    this.state.jobs.set(key(String(row.organization_id), String(row.job_id)), row)
  }

  countJobs(): number {
    return this.state.jobs.size
  }

  statementsFor(name: string): readonly SqlStatement[] {
    return this.statements.filter((entry) => entry.name === name)
  }

  async transaction<T>(work: (executor: PostgresExecutor) => Promise<T>): Promise<T> {
    const child = new FakePostgresExecutor({
      outbox: cloneRows(this.state.outbox),
      jobs: cloneRows(this.state.jobs),
      deadLetters: cloneRows(this.state.deadLetters),
      schedules: cloneRows(this.state.schedules),
    })
    const result = await work(child)
    this.state.outbox.clear()
    this.state.jobs.clear()
    this.state.deadLetters.clear()
    this.state.schedules.clear()
    for (const [entryKey, row] of child.state.outbox) this.state.outbox.set(entryKey, row)
    for (const [entryKey, row] of child.state.jobs) this.state.jobs.set(entryKey, row)
    for (const [entryKey, row] of child.state.deadLetters) this.state.deadLetters.set(entryKey, row)
    for (const [entryKey, row] of child.state.schedules) this.state.schedules.set(entryKey, row)
    this.statements.push(...child.statements)
    return result
  }

  async query(statement: SqlStatement): Promise<readonly SqlRow[]> {
    this.statements.push(statement)
    const organizationId = stringParam(statement, 0)
    if (statement.name === "dispatch.outbox.lock") {
      const row = this.state.outbox.get(key(organizationId, stringParam(statement, 1)))
      return row !== undefined && (row.dispatched_at === null || row.dispatched_at === undefined) ? [row] : []
    }
    if (statement.name === "dispatch.job.by_event") {
      return [...this.state.jobs.values()].filter(
        (row) => row.organization_id === organizationId && row.outbox_event_id === stringParam(statement, 1),
      )
    }
    if (statement.name === "dispatch.job.insert") {
      const jobKey = key(organizationId, stringParam(statement, 1))
      const eventId = stringParam(statement, 3)
      if (this.state.jobs.has(jobKey) || [...this.state.jobs.values()].some((row) => row.outbox_event_id === eventId)) return []
      const row = jobRow({
        organizationId: OrganizationIdSchema.parse(organizationId),
        jobId: JobIdSchema.parse(stringParam(statement, 1)),
        commandId: CommandIdSchema.parse(stringParam(statement, 2)),
        outboxEventId: EventIdSchema.parse(eventId),
        availableAt: stringParam(statement, 4),
      })
      this.state.jobs.set(jobKey, row)
      return [row]
    }
    if (statement.name === "dispatch.outbox.mark_dispatched") {
      const outboxKey = key(organizationId, stringParam(statement, 1))
      const row = this.state.outbox.get(outboxKey)
      if (row !== undefined) this.state.outbox.set(outboxKey, { ...row, dispatched_at: stringParam(statement, 2) })
      return []
    }
    if (statement.name === "claim.job.skip_locked") return this.claim(statement)
    if (statement.name === "claim.job.current" || statement.name === "ack.current") return this.findJob(organizationId, stringParam(statement, 1))
    if (statement.name === "commit.current_fence") return this.commit(statement)
    if (statement.name === "ack.completed_only") return this.acknowledge(statement)
    if (statement.name === "dead_letter.fence_job") return this.deadLetter(statement)
    if (statement.name === "dead_letter.insert") {
      const deadLetterOrganizationId = stringParam(statement, 1)
      this.state.deadLetters.set(key(deadLetterOrganizationId, stringParam(statement, 0)), {
        dead_letter_id: stringParam(statement, 0),
        organization_id: deadLetterOrganizationId,
        source_job_id: stringParam(statement, 2),
        command_id: stringParam(statement, 3),
      })
      return []
    }
    if (statement.name === "replay.dead_letter.lock") {
      const row = this.state.deadLetters.get(key(organizationId, stringParam(statement, 1)))
      return row === undefined ? [] : [row]
    }
    if (statement.name === "replay.job.by_dead_letter") return [...this.state.jobs.values()].filter((row) => row.organization_id === organizationId && row.replay_of_dead_letter_id === stringParam(statement, 1))
    if (statement.name === "replay.job.insert") return this.replay(statement)
    if (statement.name === "schedule.insert_unique_slot") return this.scheduleInsert(statement)
    if (statement.name === "schedule.find_unique_slot") return [...this.state.schedules.values()].filter((row) => row.organization_id === organizationId && row.task_name === stringParam(statement, 1) && row.target_key === stringParam(statement, 2) && row.slot_at === stringParam(statement, 3))
    throw new Error(`Unhandled fake statement: ${statement.name}`)
  }

  private findJob(organizationId: string, jobId: string): readonly SqlRow[] {
    const row = this.state.jobs.get(key(organizationId, jobId))
    return row === undefined ? [] : [row]
  }

  private claim(statement: SqlStatement): readonly SqlRow[] {
    const organizationId = stringParam(statement, 0)
    const jobKey = key(organizationId, stringParam(statement, 1))
    const row = this.state.jobs.get(jobKey)
    if (row === undefined) return []
    const now = stringParam(statement, 3)
    const available = String(row.available_at)
    const state = String(row.state)
    const leaseExpires = row.lease_expires_at === null ? undefined : String(row.lease_expires_at)
    const eligible = dateNotAfter(available, now) && (state === "PENDING" || state === "RETRY_SCHEDULED" || (state === "LEASED" && leaseExpires !== undefined && dateNotAfter(leaseExpires, now)))
    if (!eligible) return []
    const updated = { ...row, state: "LEASED", attempt_count: Number(row.attempt_count) + 1, lease_owner: stringParam(statement, 2), lease_expires_at: stringParam(statement, 4), fencing_generation: Number(row.fencing_generation) + 1 }
    this.state.jobs.set(jobKey, updated)
    return [updated]
  }

  private commit(statement: SqlStatement): readonly SqlRow[] {
    const jobKey = key(stringParam(statement, 0), stringParam(statement, 1))
    const row = this.state.jobs.get(jobKey)
    if (row === undefined || row.state !== "LEASED" || row.lease_owner !== stringParam(statement, 2) || row.fencing_generation !== statement.params[3]) return []
    const updated = { ...row, state: "COMPLETED", completed_at: stringParam(statement, 4) }
    this.state.jobs.set(jobKey, updated)
    return [updated]
  }

  private acknowledge(statement: SqlStatement): readonly SqlRow[] {
    const jobKey = key(stringParam(statement, 0), stringParam(statement, 1))
    const row = this.state.jobs.get(jobKey)
    if (row === undefined || row.state !== "COMPLETED") return []
    const updated = { ...row, state: "ACKNOWLEDGED", acknowledged_at: stringParam(statement, 2) }
    this.state.jobs.set(jobKey, updated)
    return [updated]
  }

  private deadLetter(statement: SqlStatement): readonly SqlRow[] {
    const jobKey = key(stringParam(statement, 0), stringParam(statement, 1))
    const row = this.state.jobs.get(jobKey)
    if (row === undefined || row.state !== "LEASED" || row.lease_owner !== stringParam(statement, 2) || row.fencing_generation !== statement.params[3]) return []
    const updated = { ...row, state: "DEAD_LETTERED" }
    this.state.jobs.set(jobKey, updated)
    return [updated]
  }

  private replay(statement: SqlStatement): readonly SqlRow[] {
    const organizationId = stringParam(statement, 0)
    const deadLetterId = stringParam(statement, 3)
    if ([...this.state.jobs.values()].some((row) => row.replay_of_dead_letter_id === deadLetterId)) return []
    const row = jobRow({ organizationId: OrganizationIdSchema.parse(organizationId), jobId: JobIdSchema.parse(stringParam(statement, 1)), commandId: CommandIdSchema.parse(stringParam(statement, 2)), replayOfDeadLetterId: deadLetterId, availableAt: stringParam(statement, 4) })
    this.state.jobs.set(key(organizationId, stringParam(statement, 1)), row)
    return [row]
  }

  private scheduleInsert(statement: SqlStatement): readonly SqlRow[] {
    const scheduleKey = [stringParam(statement, 1), stringParam(statement, 2), stringParam(statement, 3), stringParam(statement, 4)].join(":")
    if (this.state.schedules.has(scheduleKey)) return []
    const row = { trigger_id: stringParam(statement, 0), organization_id: stringParam(statement, 1), task_name: stringParam(statement, 2), target_key: stringParam(statement, 3), slot_at: stringParam(statement, 4) }
    this.state.schedules.set(scheduleKey, row)
    return [row]
  }
}
