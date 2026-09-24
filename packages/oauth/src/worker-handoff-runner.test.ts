import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { OrganizationIdSchema, ShopIdSchema } from "../../identity/src/model.ts"
import { RUNTIME_POLICY_VERSION } from "../../runtime-boundaries/src/runtime-boundaries.ts"
import { KmsEnvelopeAccessError } from "./credential-encryption.ts"
import { type KmsEnvelopeCodec, KmsMarketSchema } from "./durable-contracts.ts"
import {
  AuthorizationGrantIdSchema,
  CallbackCodeSchema,
  CredentialSubjectIdSchema,
  OAuthAttemptIdSchema,
  OAuthStateHashSchema,
  PartnerApplicationIdSchema,
  ShopeeShopIdSchema,
} from "./model.ts"
import {
  type OAuthExchangeWorkerQueue,
  type OAuthExchangeWorkerResult,
  runOAuthExchangeWorkerBatch,
  runOAuthExchangeWorkerLoop,
  runOAuthExchangeWorkerOnce,
} from "./worker-handoff-runner.ts"

const organizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
const attemptId = OAuthAttemptIdSchema.parse("20000000-0000-4000-8000-000000000001")
const lease = {
  organizationId,
  attemptId,
  workerId: "worker-a",
  leaseExpiresAt: "2026-09-10T00:01:00.000Z",
  handoff: {
    claim: {
      attemptId,
      organizationId,
      actor: { issuer: "https://issuer.example.test", subject: "runner-owner" },
      partnerApplicationId: PartnerApplicationIdSchema.parse("partner-runner"),
      market: KmsMarketSchema.parse("ID"),
      stateHash: OAuthStateHashSchema.parse("state-runner-000000000000000000000000000001"),
      issuedAt: "2026-09-10T00:00:00.000Z",
      expiresAt: "2026-09-10T01:00:00.000Z",
      shopId: ShopeeShopIdSchema.parse("1819834906"),
    },
    envelope: { keyVersion: 7, ciphertext: "sealed-runner", algorithm: "kms-envelope-v1" as const },
  },
}

function queue(
  options: { readonly failure?: boolean; readonly empty?: boolean } = {},
): OAuthExchangeWorkerQueue & { readonly calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    async claimNext() {
      calls.push("claim")
      return options.empty === true ? undefined : lease
    },
    async complete() {
      calls.push("complete")
    },
    async fail(_lease, reason) {
      calls.push(`fail:${reason}`)
      if (options.failure === true) throw new Error("lease failure")
    },
  }
}

function kms(options: { readonly fail?: boolean } = {}): KmsEnvelopeCodec {
  return {
    async seal() {
      throw new Error("not used")
    },
    async unseal() {
      if (options.fail === true) throw new KmsEnvelopeAccessError("backend_failure")
      return CallbackCodeSchema.parse("raw-code-runner")
    },
  }
}

describe("OAuth exchange worker runner", () => {
  it("claims, executes, and completes one handoff", async () => {
    // Given: a queue lease and provider-free worker dependencies.
    const workerQueue = queue()
    const result = await runOAuthExchangeWorkerOnce(
      {
        workerId: "worker-a",
        runtimeRole: "worker",
        policyVersion: RUNTIME_POLICY_VERSION,
        now: "2026-09-10T00:00:00.000Z",
        leaseSeconds: 60,
      },
      {
        queue: workerQueue,
        kms: kms(),
        provider: {
          async exchange(claim) {
            return {
              grantId: AuthorizationGrantIdSchema.parse("30000000-0000-4000-8000-000000000001"),
              organizationId: claim.organizationId,
              partnerApplicationId: claim.partnerApplicationId,
              grantKind: "shop_account" as const,
              grantedAt: "2026-09-10T00:00:00.000Z",
              subjects: [
                {
                  credentialSubjectId: CredentialSubjectIdSchema.parse(
                    "60000000-0000-4000-8000-000000000001",
                  ),
                  revision: 1,
                  keyVersion: 7,
                  shopIds: [ShopIdSchema.parse("70000000-0000-4000-8000-000000000001")],
                },
              ],
              authorizedShopId: claim.shopId,
            }
          },
        },
        persistence: { kind: "external_grant_repository", saveGrant: async () => {} },
      },
    )

    // Then: the same leased attempt completes exactly once.
    assert.deepEqual(result, { kind: "completed", attemptId })
    assert.deepEqual(workerQueue.calls, ["claim", "complete"])
  })

  it("records a safe KMS failure and does not complete the lease", async () => {
    // Given: KMS is unavailable while a worker owns the lease.
    const workerQueue = queue()
    const result = await runOAuthExchangeWorkerOnce(
      {
        workerId: "worker-a",
        runtimeRole: "worker",
        policyVersion: RUNTIME_POLICY_VERSION,
        now: "2026-09-10T00:00:00.000Z",
        leaseSeconds: 60,
      },
      {
        queue: workerQueue,
        kms: kms({ fail: true }),
        provider: {
          async exchange() {
            throw new Error("must not call")
          },
        },
        persistence: { kind: "external_grant_repository", saveGrant: async () => {} },
      },
    )

    // Then: only the safe reason is persisted.
    assert.deepEqual(result, { kind: "failed", attemptId, reason: "kms_failed" })
    assert.deepEqual(workerQueue.calls, ["claim", "fail:kms_failed"])
  })

  it("returns idle without touching KMS or provider when the queue is empty", async () => {
    const workerQueue = queue({ empty: true })
    const result = await runOAuthExchangeWorkerOnce(
      {
        workerId: "worker-a",
        runtimeRole: "worker",
        policyVersion: RUNTIME_POLICY_VERSION,
        now: "2026-09-10T00:00:00.000Z",
        leaseSeconds: 60,
      },
      {
        queue: workerQueue,
        kms: kms({ fail: true }),
        provider: {
          async exchange() {
            throw new Error("must not call")
          },
        },
        persistence: { kind: "external_grant_repository", saveGrant: async () => {} },
      },
    )
    assert.deepEqual(result, { kind: "idle" })
    assert.deepEqual(workerQueue.calls, ["claim"])
  })

  it("stops a cron batch after the queue is idle and reports only safe counters", async () => {
    // Given: one completed job followed by an empty queue.
    const outcomes: readonly OAuthExchangeWorkerResult[] = [
      { kind: "completed", attemptId },
      { kind: "idle" },
    ]
    let index = 0

    // When: a one-shot cron worker is permitted to claim up to three jobs.
    const result = await runOAuthExchangeWorkerBatch(
      { maximumClaims: 3 },
      {
        runOnce: async () => {
          const outcome = outcomes[index]
          if (outcome === undefined) throw new Error("unexpected additional claim")
          index += 1
          return outcome
        },
      },
    )

    // Then: it exits after the idle result without emitting attempt identifiers.
    assert.deepEqual(result, { kind: "idle", claimed: 1, completed: 1, failed: 0 })
  })

  it("backs off after an idle poll and stops when aborted", async () => {
    // Given: an empty queue and a worker that can be aborted during its delay.
    const controller = new AbortController()
    let runs = 0
    const result = await runOAuthExchangeWorkerLoop(
      { signal: controller.signal, idleDelayMs: 25 },
      {
        runOnce: async () => {
          runs += 1
          return { kind: "idle" }
        },
        sleep: async (delayMs, signal) => {
          assert.equal(delayMs, 25)
          assert.equal(signal, controller.signal)
          controller.abort()
        },
      },
    )

    // Then: the loop records one idle iteration and exits without another claim.
    assert.deepEqual(result, { kind: "stopped", iterations: 1, completed: 0, failed: 0 })
    assert.equal(runs, 1)
  })

  it("continues completed and failed work without the idle backoff", async () => {
    // Given: two leased outcomes and an abort after the second one.
    const controller = new AbortController()
    const results: readonly OAuthExchangeWorkerResult[] = [
      { kind: "completed", attemptId },
      { kind: "failed", attemptId, reason: "provider_failed" },
    ]
    let runs = 0
    let sleeps = 0
    const result = await runOAuthExchangeWorkerLoop(
      { signal: controller.signal, idleDelayMs: 25 },
      {
        runOnce: async () => {
          const next = results[runs]
          if (next === undefined) throw new Error("unexpected extra iteration")
          runs += 1
          if (runs === 2) controller.abort()
          return next
        },
        sleep: async () => {
          sleeps += 1
        },
      },
    )

    // Then: work outcomes are counted and no idle delay is requested.
    assert.deepEqual(result, { kind: "stopped", iterations: 2, completed: 1, failed: 1 })
    assert.equal(sleeps, 0)
  })

  it("rejects a negative idle delay before starting the loop", async () => {
    const controller = new AbortController()
    await assert.rejects(
      runOAuthExchangeWorkerLoop(
        { signal: controller.signal, idleDelayMs: -1 },
        { runOnce: async () => ({ kind: "idle" }), sleep: async () => {} },
      ),
      { name: "OAuthExchangeWorkerLoopError", reason: "invalid_delay" },
    )
  })
})
