import {
  OAuthCallbackInputSchema,
  OAuthStateRecordSchema,
  type OAuthCallbackClaim,
  type OAuthCallbackInput,
  type OAuthStateHash,
  type OAuthStateRecord,
  type SafeOAuthAttempt,
} from "./model.ts"

export type CreateOAuthStateInput = Omit<OAuthStateRecord, "status">

export type OAuthStateClaimDecision =
  | { readonly kind: "claimed"; readonly claim: OAuthCallbackClaim }
  | {
      readonly kind: "denied"
      readonly reason:
        | "state_not_found"
        | "state_expired"
        | "state_already_claimed"
        | "state_organization_mismatch"
        | "state_actor_mismatch"
    }

export interface OAuthStateStore {
  get(stateHash: OAuthStateHash): OAuthStateRecord | undefined
  replace(record: OAuthStateRecord): void
}

export class InMemoryOAuthStateStore implements OAuthStateStore {
  readonly records: Map<OAuthStateHash, OAuthStateRecord>

  constructor(records: readonly OAuthStateRecord[]) {
    this.records = new Map(records.map((record) => [record.stateHash, record]))
  }

  get(stateHash: OAuthStateHash): OAuthStateRecord | undefined {
    return this.records.get(stateHash)
  }

  replace(record: OAuthStateRecord): void {
    this.records.set(record.stateHash, record)
  }
}

export function createOAuthStateRecord(input: CreateOAuthStateInput): OAuthStateRecord {
  return OAuthStateRecordSchema.parse({ ...input, status: "issued" })
}

export function claimOAuthCallback(
  input: unknown,
  states: OAuthStateStore,
): OAuthStateClaimDecision {
  const callback = OAuthCallbackInputSchema.parse(input)
  const state = states.get(callback.stateHash)
  if (state === undefined) return { kind: "denied", reason: "state_not_found" }
  if (isOAuthStateExpired(state.expiresAt, callback.receivedAt)) {
    states.replace({ ...state, status: "expired" })
    return { kind: "denied", reason: "state_expired" }
  }
  if (state.status === "claimed") return { kind: "denied", reason: "state_already_claimed" }
  if (state.status === "expired") return { kind: "denied", reason: "state_expired" }
  if (state.organizationId !== callback.organizationId) {
    return { kind: "denied", reason: "state_organization_mismatch" }
  }
  if (state.actor.issuer !== callback.actor.issuer || state.actor.subject !== callback.actor.subject) {
    return { kind: "denied", reason: "state_actor_mismatch" }
  }
  states.replace({ ...state, status: "claimed" })
  return {
    kind: "claimed",
    claim: {
      attemptId: state.attemptId,
      organizationId: state.organizationId,
      actor: state.actor,
      partnerApplicationId: state.partnerApplicationId,
      market: state.market,
      stateHash: state.stateHash,
      issuedAt: state.issuedAt,
      expiresAt: state.expiresAt,
      shopId: callback.shopId,
      callbackCode: callback.code,
    },
  }
}

export function isOAuthStateExpired(expiresAt: string, receivedAt: string): boolean {
  const expiryInstant = Date.parse(expiresAt)
  const receivedInstant = Date.parse(receivedAt)
  return (
    !Number.isFinite(expiryInstant) ||
    !Number.isFinite(receivedInstant) ||
    expiryInstant <= receivedInstant
  )
}

export function parseOAuthCallbackInput(input: unknown): OAuthCallbackInput {
  return OAuthCallbackInputSchema.parse(input)
}

export function toSafeOAuthAttempt(state: OAuthStateRecord | undefined): SafeOAuthAttempt | undefined {
  if (state === undefined) return undefined
  return {
    attemptId: state.attemptId,
    organizationId: state.organizationId,
    partnerApplicationId: state.partnerApplicationId,
    status: state.status,
    expiresAt: state.expiresAt,
  }
}
