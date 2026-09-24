import type {
  RuntimePolicyVersion,
  RuntimeRole,
} from "../../runtime-boundaries/src/runtime-boundaries.ts"
import { KmsEnvelopeAccessError } from "./credential-encryption.ts"
import type { KmsEnvelopeCodec } from "./durable-contracts.ts"
import type {
  OAuthExchangeClaimInput,
  OAuthExchangeLease,
  PostgresOAuthExchangeQueue,
} from "./postgres-oauth-exchange-queue.ts"
import { OAuthExchangeEvidenceError } from "./worker-exchange.ts"
import {
  executeWorkerHandoffExchange,
  type WorkerHandoffExchangeDependencies,
} from "./worker-handoff-exchange.ts"

export type OAuthExchangeWorkerQueue = Pick<
  PostgresOAuthExchangeQueue,
  "claimNext" | "complete" | "fail"
>

export type OAuthExchangeWorkerInput = Omit<OAuthExchangeClaimInput, "workerId"> & {
  readonly workerId: string
  readonly runtimeRole: RuntimeRole
  readonly policyVersion: RuntimePolicyVersion
}

export type OAuthExchangeWorkerResult =
  | { readonly kind: "idle" }
  | { readonly kind: "completed"; readonly attemptId: OAuthExchangeLease["attemptId"] }
  | {
      readonly kind: "failed"
      readonly attemptId: OAuthExchangeLease["attemptId"]
      readonly reason: OAuthExchangeFailureReason
    }

export type OAuthExchangeWorkerBatchInput = {
  readonly maximumClaims: number
}

export type OAuthExchangeWorkerBatchDependencies = {
  readonly runOnce: () => Promise<OAuthExchangeWorkerResult>
}

export type OAuthExchangeWorkerBatchResult =
  | {
      readonly kind: "idle"
      readonly claimed: number
      readonly completed: number
      readonly failed: number
    }
  | {
      readonly kind: "limit_reached"
      readonly claimed: number
      readonly completed: number
      readonly failed: number
    }

export type OAuthExchangeFailureReason =
  | "kms_failed"
  | "provider_failed"
  | "persistence_failed"
  | "unknown_failure"

export type OAuthExchangeWorkerLoopInput = {
  readonly signal: AbortSignal
  readonly idleDelayMs: number
}

export type OAuthExchangeWorkerLoopDependencies = {
  readonly runOnce: () => Promise<OAuthExchangeWorkerResult>
  readonly sleep: (delayMs: number, signal: AbortSignal) => Promise<void>
}

export type OAuthExchangeWorkerLoopResult = {
  readonly kind: "stopped"
  readonly iterations: number
  readonly completed: number
  readonly failed: number
}

export class OAuthExchangeWorkerLoopError extends Error {
  readonly name = "OAuthExchangeWorkerLoopError"
  readonly reason: "invalid_delay"

  constructor(reason: OAuthExchangeWorkerLoopError["reason"]) {
    super("OAuth exchange worker loop configuration is invalid")
    this.reason = reason
  }
}

export class OAuthExchangeWorkerBatchError extends Error {
  readonly name = "OAuthExchangeWorkerBatchError"
  readonly reason: "invalid_maximum_claims"

  constructor(reason: OAuthExchangeWorkerBatchError["reason"]) {
    super("OAuth exchange worker batch configuration is invalid")
    this.reason = reason
  }
}

export async function runOAuthExchangeWorkerOnce(
  input: OAuthExchangeWorkerInput,
  dependencies: {
    readonly queue: OAuthExchangeWorkerQueue
    readonly kms: KmsEnvelopeCodec
    readonly provider: WorkerHandoffExchangeDependencies["provider"]
    readonly persistence: WorkerHandoffExchangeDependencies["persistence"]
  },
): Promise<OAuthExchangeWorkerResult> {
  const lease = await dependencies.queue.claimNext(input)
  if (lease === undefined) return { kind: "idle" }
  try {
    await executeWorkerHandoffExchange(
      {
        runtimeRole: input.runtimeRole,
        policyVersion: input.policyVersion,
        handoff: lease.handoff,
      },
      {
        kms: dependencies.kms,
        provider: dependencies.provider,
        persistence: dependencies.persistence,
      },
    )
    await dependencies.queue.complete(lease)
    return { kind: "completed", attemptId: lease.attemptId }
  } catch (error) {
    const reason = classifyFailure(error)
    await dependencies.queue.fail(lease, reason)
    return { kind: "failed", attemptId: lease.attemptId, reason }
  }
}

export async function runOAuthExchangeWorkerBatch(
  input: OAuthExchangeWorkerBatchInput,
  dependencies: OAuthExchangeWorkerBatchDependencies,
): Promise<OAuthExchangeWorkerBatchResult> {
  if (!Number.isInteger(input.maximumClaims) || input.maximumClaims <= 0) {
    throw new OAuthExchangeWorkerBatchError("invalid_maximum_claims")
  }

  let claimed = 0
  let completed = 0
  let failed = 0
  for (let index = 0; index < input.maximumClaims; index += 1) {
    const result = await dependencies.runOnce()
    switch (result.kind) {
      case "idle":
        return { kind: "idle", claimed, completed, failed }
      case "completed":
        claimed += 1
        completed += 1
        break
      case "failed":
        claimed += 1
        failed += 1
        break
      default:
        return assertNever(result)
    }
  }

  return { kind: "limit_reached", claimed, completed, failed }
}

export async function runOAuthExchangeWorkerLoop(
  input: OAuthExchangeWorkerLoopInput,
  dependencies: OAuthExchangeWorkerLoopDependencies,
): Promise<OAuthExchangeWorkerLoopResult> {
  if (!Number.isInteger(input.idleDelayMs) || input.idleDelayMs < 0) {
    throw new OAuthExchangeWorkerLoopError("invalid_delay")
  }

  let iterations = 0
  let completed = 0
  let failed = 0
  while (!input.signal.aborted) {
    const result = await dependencies.runOnce()
    iterations += 1
    switch (result.kind) {
      case "idle":
        await dependencies.sleep(input.idleDelayMs, input.signal)
        break
      case "completed":
        completed += 1
        break
      case "failed":
        failed += 1
        break
      default:
        return assertNever(result)
    }
  }

  return { kind: "stopped", iterations, completed, failed }
}

function classifyFailure(error: unknown): OAuthExchangeFailureReason {
  if (error instanceof KmsEnvelopeAccessError) return "kms_failed"
  if (error instanceof OAuthExchangeEvidenceError) return "provider_failed"
  if (error instanceof Error && error.name === "OAuthGrantPersistenceError")
    return "persistence_failed"
  return "unknown_failure"
}

function assertNever(value: never): never {
  throw new Error(`Unexpected OAuth worker result: ${String(value)}`)
}
