import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { parseCommandEnvelope } from "./contracts.ts"

const validEnvelope = {
  organizationId: "10000000-0000-4000-8000-000000000001",
  commandId: "20000000-0000-4000-8000-000000000001",
  commandType: "catalog.sync",
  schemaVersion: 1,
  aggregateType: "shop",
  aggregateId: "shop-1",
  dedupeKey: "catalog.sync:shop-1:slot-1",
  createdAt: "2026-09-09T00:00:00.000Z",
  payload: { shopId: "shop-1" },
}

describe("command envelope boundary", () => {
  it("rejects malformed event identity and schema version", () => {
    // Given: an envelope with an invalid server command identity and version.
    const input = { ...validEnvelope, commandId: "client-hash", schemaVersion: 0 }

    // When: the untrusted envelope crosses the delivery boundary.
    const action = (): void => {
      parseCommandEnvelope(input)
    }

    // Then: parsing rejects the malformed input.
    assert.throws(action)
  })

  it("rejects nested secret-like fields without reflecting their value", () => {
    // Given: an otherwise valid command with a credential-shaped nested payload.
    const secretCanary = "must-never-enter-a-queue"
    const action = (): void => {
      parseCommandEnvelope({
        ...validEnvelope,
        payload: { safe: { access_token: secretCanary } },
      })
    }

    // When: the command payload is parsed.
    let message = ""
    try {
      action()
    } catch (error) {
      if (error instanceof Error) message = error.message
      else throw error
    }

    // Then: parsing fails closed and the error does not disclose the secret value.
    assert.notEqual(message, "")
    assert.equal(message.includes(secretCanary), false)
  })

  it("rejects a scalar payload that the delivery migration cannot store", () => {
    const action = (): void => {
      parseCommandEnvelope({ ...validEnvelope, payload: "not-an-object" })
    }

    assert.throws(action)
  })

  it("rejects punctuation-separated sensitive keys", () => {
    const action = (): void => {
      parseCommandEnvelope({
        ...validEnvelope,
        payload: { "partner-key": "must-never-enter-a-queue" },
      })
    }

    assert.throws(action)
  })
})
