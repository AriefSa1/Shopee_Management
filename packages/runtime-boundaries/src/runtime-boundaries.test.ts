import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  RUNTIME_POLICY_VERSION,
  RuntimeCapabilityDeniedError,
  evaluateRuntimeCapability,
  requireRuntimeCapability,
} from "./runtime-boundaries.ts"
import { requireWorkerSecretProviderAccess, WORKER_SECRET_NAMES } from "./worker-secret-provider.ts"

describe("runtime capability boundaries", () => {
  it("denies the web role access to the worker-only secret capability", () => {
    // Given: the web runtime and the current policy version.
    const request = {
      role: "web",
      capability: "secret_provider",
      policyVersion: RUNTIME_POLICY_VERSION,
    } as const

    // When: web attempts to access the worker-only secret provider.
    const decision = evaluateRuntimeCapability(request)

    // Then: the safe observable result is a deterministic denial.
    assert.deepEqual(decision, {
      allowed: false,
      reason: "capability_denied",
      role: "web",
      capability: "secret_provider",
    })
    assert.throws(() => requireRuntimeCapability(request), RuntimeCapabilityDeniedError)
    assert.throws(
      () => requireWorkerSecretProviderAccess("web", RUNTIME_POLICY_VERSION),
      RuntimeCapabilityDeniedError,
    )
  })

  it("denies a stale policy version before evaluating permissions", () => {
    // Given: a worker request carrying an obsolete policy version.
    const request = {
      role: "worker",
      capability: "secret_provider",
      policyVersion: "phase0_v1",
    } as const

    // When: the stale request reaches the capability gate.
    const decision = evaluateRuntimeCapability(request)

    // Then: it is denied without granting access based on an old allowlist.
    assert.equal(decision.allowed, false)
    assert.equal(decision.reason, "policy_version_mismatch")
  })

  it("allows the worker role to use the secret capability under the current policy", () => {
    // Given: the worker runtime and the current policy version.
    const request = {
      role: "worker",
      capability: "secret_provider",
      policyVersion: RUNTIME_POLICY_VERSION,
    } as const

    // When: the worker evaluates its capability.
    const decision = evaluateRuntimeCapability(request)

    // Then: the explicit allowlist grants it.
    assert.deepEqual(decision, { allowed: true, role: "worker", capability: "secret_provider" })
  })

  it("denies migration and readonly-support roles access to credentials", () => {
    const roles = ["migration", "readonly-support"] as const
    for (const role of roles) {
      const decision = evaluateRuntimeCapability({
        role,
        capability: "secret_provider",
        policyVersion: RUNTIME_POLICY_VERSION,
      })
      assert.deepEqual(decision, {
        allowed: false,
        reason: "capability_denied",
        role,
        capability: "secret_provider",
      })
    }
  })

  it("exposes only opaque credential material to the worker secret provider", () => {
    assert.deepEqual(WORKER_SECRET_NAMES, [
      "partner_application_key",
      "oauth_callback_code",
      "credential_subject_envelope",
    ])
  })
})
