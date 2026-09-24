import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { OrganizationIdSchema } from "../../identity/src/model.ts"
import {
  OAuthAttemptIdSchema,
  OAuthCallbackInputSchema,
  OAuthStateHashSchema,
  PartnerApplicationIdSchema,
  type OAuthStateRecord,
} from "./model.ts"
import { FakeOAuthStatePostgresExecutor } from "./postgres-state.fake.ts"
import { PostgresOAuthStateRepository } from "./postgres-state.ts"

const organizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
const otherOrganizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000009")
const attemptId = OAuthAttemptIdSchema.parse("20000000-0000-4000-8000-000000000001")
const stateHash = OAuthStateHashSchema.parse("state-pg-fixture-000000000000000000000000001")
const partnerApplicationId = PartnerApplicationIdSchema.parse("partner-fixture")

const record: OAuthStateRecord = {
  attemptId,
  organizationId,
  actor: { issuer: "https://issuer.example.test", subject: "subject-1" },
  partnerApplicationId,
  market: "ID",
  stateHash,
  issuedAt: "2026-09-09T00:00:00.000Z",
  expiresAt: "2026-09-09T00:10:00.000Z",
  status: "issued",
}

function callback(input: Partial<Parameters<typeof OAuthCallbackInputSchema.parse>[0]> = {}) {
  return OAuthCallbackInputSchema.parse({
    stateHash,
    organizationId,
    actor: record.actor,
    receivedAt: "2026-09-09T00:01:00.000Z",
    code: "raw-code-fixture",
    shopId: "1819834906",
    ...input,
  })
}

describe("PostgreSQL OAuth state persistence contract", () => {
  it("persists an organization-scoped safe projection and never sends callback code to SQL", async () => {
    // Given: an issued OAuth state containing no callback code.
    const executor = new FakeOAuthStatePostgresExecutor()
    const repository = new PostgresOAuthStateRepository(executor)

    // When: the state is persisted and loaded through the repository.
    await repository.save(record)
    const loaded = await repository.get(organizationId, stateHash)

    // Then: the durable projection is complete and every SQL parameter excludes the raw code.
    assert.deepEqual(loaded, record)
    assert.equal(executor.statementsFor("oauth.state.insert").length, 1)
    assert.equal(executor.statements.flatMap((statement) => statement.params).includes("raw-code-fixture"), false)
  })

  it("claims once inside a transaction with a row lock and returns the code only in memory", async () => {
    // Given: one issued state owned by the callback organization and actor.
    const executor = new FakeOAuthStatePostgresExecutor()
    const repository = new PostgresOAuthStateRepository(executor)
    await repository.save(record)

    // When: the callback is claimed twice.
    const first = await repository.claim(callback())
    const replay = await repository.claim(callback())

    // Then: the first claim succeeds, replay is denied, and the lock statement is explicit.
    assert.equal(first.kind, "claimed")
    if (first.kind === "claimed") assert.equal(first.claim.callbackCode, "raw-code-fixture")
    assert.deepEqual(replay, { kind: "denied", reason: "state_already_claimed" })
    assert.equal(executor.statementsFor("oauth.state.claim.lock").length, 2)
    assert.match(executor.statementsFor("oauth.state.claim.lock")[0]?.text ?? "", /FOR UPDATE/)
    assert.equal(executor.statements.flatMap((statement) => statement.params).includes("raw-code-fixture"), false)
  })

  it("fails closed for organization and actor substitution without claiming state", async () => {
    // Given: an issued state owned by one organization and actor.
    const executor = new FakeOAuthStatePostgresExecutor()
    const repository = new PostgresOAuthStateRepository(executor)
    await repository.save(record)

    // When: a foreign organization and then a foreign actor present the callback.
    const foreignOrganization = await repository.claim(callback({ organizationId: otherOrganizationId }))
    const foreignActor = await repository.claim(callback({ actor: { issuer: record.actor.issuer, subject: "other-subject" } }))

    // Then: neither request can claim or mutate the state.
    assert.deepEqual(foreignOrganization, { kind: "denied", reason: "state_not_found" })
    assert.deepEqual(foreignActor, { kind: "denied", reason: "state_actor_mismatch" })
    const loaded = await repository.get(organizationId, stateHash)
    assert.equal(loaded?.status, "issued")
  })

  it("marks expired state and preserves the expired status", async () => {
    // Given: a state whose expiry instant is before the callback instant.
    const executor = new FakeOAuthStatePostgresExecutor()
    const repository = new PostgresOAuthStateRepository(executor)
    await repository.save({ ...record, expiresAt: "2026-09-09T00:00:30.000Z" })

    // When: the expired callback is presented.
    const result = await repository.claim(callback({ receivedAt: "2026-09-09T00:01:00.000Z" }))

    // Then: the callback is denied and the durable state is expired.
    assert.deepEqual(result, { kind: "denied", reason: "state_expired" })
    assert.equal((await repository.get(organizationId, stateHash))?.status, "expired")
  })

  it("keeps migration organization scope, row locking, and callback-code exclusion explicit", () => {
    // Given: the OAuth state persistence migration source.
    const migration = readFileSync(new URL("../../../db/migrations/0004_oauth.sql", import.meta.url), "utf8")

    // When: the migration contract is inspected.
    // Then: storage is organization scoped, claim locking is available, and raw code has no column.
    assert.match(migration, /organization_id uuid NOT NULL REFERENCES organizations\s*\(id\)/)
    assert.match(migration, /PRIMARY KEY \(organization_id, state_hash\)/)
    assert.match(migration, /claimed_at timestamptz/)
    assert.doesNotMatch(migration, /callback_code|authorization_code/i)
  })
})
