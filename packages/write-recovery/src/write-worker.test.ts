import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { RUNTIME_POLICY_VERSION } from "../../runtime-boundaries/src/runtime-boundaries.ts"
import { createWritePlan } from "./recovery.ts"
import { FakeWriteRecoveryPostgresExecutor } from "./postgres-write-recovery.fake.ts"
import { PostgresWriteRecoveryRepository } from "./postgres-write-recovery.ts"
import { executeConfirmedWriteWorker, type ConfirmedWriteProvider, type ConfirmedWriteRevalidator } from "./write-worker.ts"

const organizationId = "10000000-0000-4000-8000-000000000001"
const shopId = "30000000-0000-4000-8000-000000000001"
const payloadHash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
const previewHash = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
const allowRevalidation: ConfirmedWriteRevalidator = async () => ({ kind: "allowed" })

function plan() {
  return createWritePlan({ organizationId, actorId: "owner-worker", intentId: "intent-worker", previewHash, commandVersion: 1, destinations: [{ shopId, payloadHash }] }, { status: "verified", evidence: "official-fixture-capability" })
}

function provider(options: { readonly failAt?: string; readonly unknownAt?: string; readonly calls?: string[] } = {}): ConfirmedWriteProvider {
  const step = async (name: string, reference: string) => {
    options.calls?.push(name)
    if (options.failAt === name) return { kind: "failed" as const, reason: "provider_rejected" }
    if (options.unknownAt === name) throw new Error("timeout after send")
    return { kind: "succeeded" as const, providerReference: reference }
  }
  return {
    mediaUpload: () => step("media_upload", "media-1"),
    itemCreate: () => step("item_create", "item-1"),
    variationInit: () => step("variation_init", "variation-1"),
    publication: () => step("publication", "publication-1"),
  }
}

async function dispatchedFixture() {
  const writePlan = plan()
  const attempt = writePlan.attempts[0]
  assert.ok(attempt)
  const dispatched = { ...attempt, state: "dispatched" as const, dispatchAllowed: false }
  const executor = new FakeWriteRecoveryPostgresExecutor()
  const persistence = new PostgresWriteRecoveryRepository(executor)
  await persistence.savePlan({ plan: writePlan, metadata: { actorId: "owner-worker", intentId: "intent-worker", previewHash, commandVersion: 1 } })
  await persistence.updateAttempt({ attempt: dispatched, expectedState: "pending" })
  return { writePlan, dispatched, executor, persistence }
}

function input(writePlan: ReturnType<typeof plan>, dispatched: import("./model.ts").WriteAttempt) {
  return { runtimeRole: "worker" as const, policyVersion: RUNTIME_POLICY_VERSION, plan: writePlan, attempt: dispatched, confirmationBinding: writePlan.confirmationBinding }
}

describe("confirmed write worker contract", () => {
  it("executes all four steps and persists terminal success", async () => {
    const fixture = await dispatchedFixture()
    const calls: string[] = []
    const result = await executeConfirmedWriteWorker(input(fixture.writePlan, fixture.dispatched), { persistence: fixture.persistence, provider: provider({ calls }), revalidate: allowRevalidation })
    assert.equal(result.kind, "succeeded")
    assert.deepEqual(calls, ["media_upload", "item_create", "variation_init", "publication"])
    assert.equal(result.attempt.state, "succeeded")
    assert.equal(fixture.executor.statements.filter((statement) => statement.name === "external.operation.insert").length, 4)
  })

  it("maps a timeout after send to outcome_unknown and never calls later steps", async () => {
    const fixture = await dispatchedFixture()
    const calls: string[] = []
    const result = await executeConfirmedWriteWorker(input(fixture.writePlan, fixture.dispatched), { persistence: fixture.persistence, provider: provider({ unknownAt: "item_create", calls }), revalidate: allowRevalidation })
    assert.deepEqual(result.kind, "outcome_unknown")
    if (result.kind === "outcome_unknown") assert.equal(result.step, "item_create")
    assert.deepEqual(calls, ["media_upload", "item_create"])
    assert.equal(fixture.executor.statements.filter((statement) => statement.name === "external.operation.update").some((statement) => statement.params[0] === "outcome_unknown"), true)
  })

  it("returns a known provider failure as terminal failed without blind retry", async () => {
    const fixture = await dispatchedFixture()
    const result = await executeConfirmedWriteWorker(input(fixture.writePlan, fixture.dispatched), { persistence: fixture.persistence, provider: provider({ failAt: "variation_init" }), revalidate: allowRevalidation })
    assert.deepEqual(result, { kind: "failed", attempt: { ...fixture.dispatched, state: "failed", dispatchAllowed: false, outcomeReason: "provider_rejected" }, reason: "provider_rejected" })
  })

  it("does not call the provider again after a persisted terminal success", async () => {
    const fixture = await dispatchedFixture()
    const first = await executeConfirmedWriteWorker(input(fixture.writePlan, fixture.dispatched), { persistence: fixture.persistence, provider: provider(), revalidate: allowRevalidation })
    assert.equal(first.kind, "succeeded")
    let calls = 0
    const replay = await executeConfirmedWriteWorker(input(fixture.writePlan, first.attempt), { persistence: fixture.persistence, provider: { ...provider(), mediaUpload: async () => { calls += 1; return { kind: "succeeded", providerReference: "unexpected" } } }, revalidate: allowRevalidation })
    assert.equal(replay.kind, "succeeded")
    assert.equal(calls, 0)
  })

  it("denies unknown capability and binding before persistence or provider access", async () => {
    const fixture = await dispatchedFixture()
    let calls = 0
    const blockedPlan = { ...fixture.writePlan, kind: "write_disabled" as const, capability: { status: "unknown" as const, evidence: "unknown" } }
    await assert.rejects(executeConfirmedWriteWorker({ ...input(blockedPlan, fixture.dispatched), confirmationBinding: "mismatch" }, { persistence: fixture.persistence, provider: { ...provider(), mediaUpload: async () => { calls += 1; return { kind: "succeeded", providerReference: "unexpected" } } }, revalidate: allowRevalidation }), /Confirmed write worker rejected/)
    assert.equal(calls, 0)
  })

  it("revalidates each step before sending and denies without provider access", async () => {
    const fixture = await dispatchedFixture()
    const calls: string[] = []
    const result = await executeConfirmedWriteWorker(input(fixture.writePlan, fixture.dispatched), {
      persistence: fixture.persistence,
      provider: provider({ calls }),
      revalidate: async () => ({ kind: "denied", reason: "authorization_revoked" }),
    })

    assert.deepEqual(calls, [])
    assert.deepEqual(result, {
      kind: "denied",
      attempt: fixture.dispatched,
      step: "media_upload",
      reason: "authorization_revoked",
      providerReferences: [],
    })
    assert.equal(
      fixture.executor.statements.some(
        (statement) => statement.name === "external.operation.update" && statement.params[0] === "sent",
      ),
      false,
    )
  })

  it("revalidates again after a successful step before continuing", async () => {
    const fixture = await dispatchedFixture()
    const calls: string[] = []
    const steps: string[] = []
    const result = await executeConfirmedWriteWorker(input(fixture.writePlan, fixture.dispatched), {
      persistence: fixture.persistence,
      provider: provider({ calls }),
      revalidate: async ({ step }) => {
        steps.push(step)
        return step === "item_create" ? { kind: "denied", reason: "command_stale" } : { kind: "allowed" }
      },
    })

    assert.deepEqual(steps, ["media_upload", "item_create"])
    assert.deepEqual(calls, ["media_upload"])
    assert.equal(result.kind, "denied")
    if (result.kind === "denied") {
      assert.equal(result.step, "item_create")
      assert.equal(result.reason, "command_stale")
      assert.deepEqual(result.providerReferences, ["media-1"])
    }
  })
})
