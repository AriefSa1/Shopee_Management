import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { parseAuditEvent } from "./audit-event.ts"

const BASE_EVENT = {
  eventId: "40000000-0000-4000-8000-000000000001",
  version: 1,
  organizationId: "10000000-0000-4000-8000-000000000001",
  actorUserId: "20000000-0000-4000-8000-000000000001",
  correlationId: "50000000-0000-4000-8000-000000000001",
  occurredAt: "2026-09-09T00:00:00.000Z",
} as const

describe("audit event boundary", () => {
  it("accepts a secret-free authorization decision", () => {
    // Given: a fully allowlisted authorization audit event.
    const event = {
      ...BASE_EVENT,
      details: {
        kind: "authorization_decision",
        permission: "confirm_publish",
        decision: "deny",
        reasonCode: "role_forbidden",
        shopIds: ["30000000-0000-4000-8000-000000000001"],
      },
    } as const

    // When: the event crosses the append-only audit boundary.
    const parsed = parseAuditEvent(event)

    // Then: its safe identifiers and reason code remain observable.
    assert.deepEqual(parsed.details, event.details)
  })

  it("rejects credential-like fields instead of silently redacting them", () => {
    // Given: an authorization event with a forbidden token-bearing field.
    const event = {
      ...BASE_EVENT,
      details: {
        kind: "authorization_decision",
        permission: "confirm_publish",
        decision: "deny",
        reasonCode: "role_forbidden",
        shopIds: ["30000000-0000-4000-8000-000000000001"],
        accessToken: "secret-canary",
      },
    } as const

    // When: the unsafe event crosses the audit boundary.
    const parsed = () => parseAuditEvent(event)

    // Then: strict allowlisting rejects the payload.
    assert.throws(parsed)
  })
})
