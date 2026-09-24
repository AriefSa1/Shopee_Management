import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { parseAuthorizationRequest } from "./boundary.ts"

const VALID_REQUEST = {
  identity: { issuer: "https://id.example.test", subject: "operator-1" },
  organizationId: "10000000-0000-4000-8000-000000000001",
  permission: "confirm_publish",
  expectedAuthzRevision: 7,
  shopIds: ["30000000-0000-4000-8000-000000000001"],
  recoveryApproval: false,
} as const

describe("authorization boundary", () => {
  it("rejects a malformed role-bearing permission", () => {
    // Given: a request carrying a value outside the approved permission vocabulary.
    const malformed = { ...VALID_REQUEST, permission: "staff_can_publish" }

    // When: the untrusted request crosses the authorization boundary.
    const parsed = () => parseAuthorizationRequest(malformed)

    // Then: malformed authorization vocabulary is rejected before domain execution.
    assert.throws(parsed)
  })

  it("rejects a malformed issuer-subject identity", () => {
    // Given: an OIDC identity without a valid issuer URL or non-empty subject.
    const malformed = { ...VALID_REQUEST, identity: { issuer: "local", subject: "" } }

    // When: the untrusted request crosses the authorization boundary.
    const parsed = () => parseAuthorizationRequest(malformed)

    // Then: the identity is rejected before repository lookup.
    assert.throws(parsed)
  })
})
