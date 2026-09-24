import { createHash } from "node:crypto"
import {
  CommandIdSchema,
  EventIdSchema,
  OrganizationIdSchema,
  parseCommandEnvelope,
  type CommandEnvelope,
} from "../../delivery/src/contracts.ts"
import type { OutboxEvent } from "../../delivery/src/delivery-types.ts"
import {
  type DispatchDeniedReason,
  type WriteAttempt,
  type WritePlan,
  WriteTimestampSchema,
} from "./model.ts"
import { dispatchAttempt } from "./recovery.ts"

function deterministicUuid(seed: string): string {
  const bytes = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("")
  bytes[12] = "5"
  bytes[16] = ((Number.parseInt(bytes[16] ?? "0", 16) & 0x3) | 0x8).toString(16)
  const hex = bytes.join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export type ConfirmedWriteDispatch = {
  readonly attempt: WriteAttempt
  readonly command: CommandEnvelope
  readonly outbox: OutboxEvent
}

export class ConfirmedDispatchContractError extends Error {
  readonly name = "ConfirmedDispatchContractError"
  readonly code: DispatchDeniedReason

  constructor(code: DispatchDeniedReason) {
    super("Confirmed write dispatch was denied by the write-recovery contract")
    this.code = code
  }
}

export function createConfirmedWriteDispatch(
  plan: WritePlan,
  attempt: WriteAttempt,
  confirmationBinding: string,
  createdAt: string,
): ConfirmedWriteDispatch {
  const dispatched = dispatchAttempt(plan, attempt, confirmationBinding)
  if (dispatched.kind === "denied") throw new ConfirmedDispatchContractError(dispatched.reason)

  const normalizedCreatedAt = WriteTimestampSchema.parse(createdAt)
  const deliveryOrganizationId = OrganizationIdSchema.parse(dispatched.attempt.organizationId)
  const deliveryCommandId = CommandIdSchema.parse(deterministicUuid(`write-command:${dispatched.attempt.attemptId}`))
  const eventId = EventIdSchema.parse(deterministicUuid(`write-outbox:${dispatched.attempt.attemptId}:${confirmationBinding}`))
  const dedupeKey = `write:${plan.commandId}:${dispatched.attempt.attemptId}`
  const command = parseCommandEnvelope({
    organizationId: deliveryOrganizationId,
    commandId: deliveryCommandId,
    commandType: "shopee.copy.publish",
    schemaVersion: 1,
    aggregateType: "shopee-write-attempt",
    aggregateId: dispatched.attempt.attemptId,
    dedupeKey,
    createdAt: normalizedCreatedAt,
    payload: {
      writeCommandId: plan.commandId,
      writeAttemptId: dispatched.attempt.attemptId,
      confirmationBinding: dispatched.attempt.confirmationBinding,
      destinationShopId: dispatched.attempt.destinationShopId,
      payloadHash: dispatched.attempt.payloadHash,
      capabilityEvidence: plan.capability.evidence,
    },
  })
  const outbox: OutboxEvent = {
    organizationId: deliveryOrganizationId,
    eventId,
    eventType: "shopee.write.confirmed",
    schemaVersion: 1,
    commandId: deliveryCommandId,
    aggregateType: "shopee-write-attempt",
    aggregateId: dispatched.attempt.attemptId,
    dedupeKey,
    availableAt: normalizedCreatedAt,
    createdAt: normalizedCreatedAt,
  }
  return { attempt: dispatched.attempt, command, outbox }
}
