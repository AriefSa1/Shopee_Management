export const SAFE_TELEMETRY_CHANNELS = ["log", "audit", "metric"] as const
export const SAFE_TELEMETRY_EVENTS = [
  "runtime_capability_allowed",
  "runtime_capability_denied",
  "untrusted_boundary_redacted",
] as const
export const SAFE_TELEMETRY_ATTRIBUTE_NAMES = [
  "capability",
  "outcome",
  "policy_version",
  "redacted_field_count",
] as const
export const SAFE_TELEMETRY_CODES = [
  "secret_provider",
  "allowed",
  "denied",
  "phase1_v1",
  "untrusted_error",
] as const

export type SafeTelemetryChannel = (typeof SAFE_TELEMETRY_CHANNELS)[number]
export type SafeTelemetryEvent = (typeof SAFE_TELEMETRY_EVENTS)[number]
export type SafeTelemetryAttributeName = (typeof SAFE_TELEMETRY_ATTRIBUTE_NAMES)[number]
export type SafeTelemetryCode = (typeof SAFE_TELEMETRY_CODES)[number]
export type SafeTelemetryAttributeValue = SafeTelemetryCode | number | boolean

export class CorrelationId {
  readonly value: string

  private constructor(value: string) {
    this.value = value
  }

  static create(): CorrelationId {
    return new CorrelationId(crypto.randomUUID())
  }
}

export type CorrelationContext = {
  readonly requestId: CorrelationId
  readonly confirmationId?: CorrelationId
  readonly intentId?: CorrelationId
  readonly commandId?: CorrelationId
  readonly outboxId?: CorrelationId
  readonly queueLeaseId?: CorrelationId
  readonly attemptId?: CorrelationId
}

export type SafeError = {
  readonly code: "untrusted_error"
  readonly truncated: boolean
}

export type RedactedUntrustedRecord = {
  readonly kind: "untrusted_record_redacted"
  readonly observedFieldCount: number
  readonly truncated: boolean
}

export type SafeTelemetryRecord = {
  readonly channel: SafeTelemetryChannel
  readonly event: SafeTelemetryEvent
  readonly correlation: Readonly<Record<string, string>>
  readonly attributes: Readonly<Partial<Record<SafeTelemetryAttributeName, SafeTelemetryAttributeValue>>>
  readonly error?: SafeError
}

export type SafeTelemetryRecordInput = {
  readonly channel: SafeTelemetryChannel
  readonly event: SafeTelemetryEvent
  readonly correlation: CorrelationContext
  readonly attributes: Readonly<Partial<Record<SafeTelemetryAttributeName, SafeTelemetryAttributeValue>>>
  readonly error?: SafeError
}

const MAX_UNTRUSTED_FIELDS = 64

export function createCorrelationId(): CorrelationId {
  return CorrelationId.create()
}

export function createCorrelationContext(input: CorrelationContext): CorrelationContext {
  return input
}

export function redactUntrustedRecord(value: unknown): RedactedUntrustedRecord {
  const fieldCount = safelyCountUntrustedFields(value)
  return {
    kind: "untrusted_record_redacted",
    observedFieldCount: fieldCount.count,
    truncated: fieldCount.truncated,
  }
}

export function toSafeError(error: unknown): SafeError {
  return {
    code: "untrusted_error",
    truncated: error !== undefined && error !== null,
  }
}

export function createSafeTelemetryRecord(input: SafeTelemetryRecordInput): SafeTelemetryRecord {
  return {
    channel: input.channel,
    event: input.event,
    correlation: serializeCorrelation(input.correlation),
    attributes: canonicalizeAttributes(input.attributes),
    ...(input.error === undefined ? {} : { error: input.error }),
  }
}

function canonicalizeAttributes(
  value: unknown,
): Readonly<Partial<Record<SafeTelemetryAttributeName, SafeTelemetryAttributeValue>>> {
  if (value === null || typeof value !== "object") return {}

  const attributes: Partial<Record<SafeTelemetryAttributeName, SafeTelemetryAttributeValue>> = {}
  try {
    for (const name of SAFE_TELEMETRY_ATTRIBUTE_NAMES) {
      const descriptor = Object.getOwnPropertyDescriptor(value, name)
      if (descriptor?.enumerable !== true || !("value" in descriptor)) continue
      if (isSafeTelemetryAttributeValue(descriptor.value)) {
        attributes[name] = descriptor.value
      }
    }
  } catch {
    return {}
  }
  return attributes
}

function isSafeTelemetryAttributeValue(value: unknown): value is SafeTelemetryAttributeValue {
  if (typeof value === "boolean") return true
  if (typeof value === "number") return Number.isFinite(value)
  return typeof value === "string" && isSafeTelemetryCode(value)
}

function isSafeTelemetryCode(value: string): value is SafeTelemetryCode {
  return SAFE_TELEMETRY_CODES.some((code) => code === value)
}

function serializeCorrelation(context: CorrelationContext): Readonly<Record<string, string>> {
  return {
    request_id: context.requestId.value,
    ...(context.confirmationId === undefined
      ? {}
      : { confirmation_id: context.confirmationId.value }),
    ...(context.intentId === undefined ? {} : { intent_id: context.intentId.value }),
    ...(context.commandId === undefined ? {} : { command_id: context.commandId.value }),
    ...(context.outboxId === undefined ? {} : { outbox_id: context.outboxId.value }),
    ...(context.queueLeaseId === undefined ? {} : { queue_lease_id: context.queueLeaseId.value }),
    ...(context.attemptId === undefined ? {} : { attempt_id: context.attemptId.value }),
  }
}

function countUntrustedFields(value: unknown): { readonly count: number; readonly truncated: boolean } {
  const pending: unknown[] = [value]
  let count = 0

  while (pending.length > 0) {
    const current = pending.pop()
    if (current === undefined || current === null || typeof current !== "object") continue

    const fieldNames = Object.keys(current)
    count += fieldNames.length
    if (count > MAX_UNTRUSTED_FIELDS) {
      return { count: MAX_UNTRUSTED_FIELDS, truncated: true }
    }
    for (const fieldName of fieldNames) {
      const descriptor = Object.getOwnPropertyDescriptor(current, fieldName)
      if (descriptor !== undefined && "value" in descriptor) pending.push(descriptor.value)
    }
  }

  return { count, truncated: false }
}

function safelyCountUntrustedFields(
  value: unknown,
): { readonly count: number; readonly truncated: boolean } {
  try {
    return countUntrustedFields(value)
  } catch {
    return { count: MAX_UNTRUSTED_FIELDS, truncated: true }
  }
}
