import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { isOAuthStateExpired } from "./state.ts"

describe("OAuth state instant comparison", () => {
  it("compares equivalent instants across valid ISO offsets", () => {
    // Given: expiry and callback timestamps that express the same UTC instant with different offsets.
    const expiresAt = "2026-09-09T07:00:00+02:00"
    const receivedAt = "2026-09-09T05:00:00.000Z"

    // When: the callback state expiry is evaluated.
    const expired = isOAuthStateExpired(expiresAt, receivedAt)

    // Then: equality is expired regardless of lexical offset representation.
    assert.equal(expired, true)
  })

  it("fails closed when an expiry instant cannot be parsed", () => {
    // Given: a malformed persisted expiry value and an otherwise valid callback instant.
    const expiresAt = "not-a-date"
    const receivedAt = "2026-09-09T05:00:00.000Z"

    // When: expiry is evaluated at the OAuth state boundary.
    const expired = isOAuthStateExpired(expiresAt, receivedAt)

    // Then: the state is treated as expired rather than accepted.
    assert.equal(expired, true)
  })
})
