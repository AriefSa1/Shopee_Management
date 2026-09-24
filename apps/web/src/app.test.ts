import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { createConfiguredDatabaseReadinessProbe } from "../../../packages/persistence/src/configured-database-readiness.ts"
import { InMemoryOAuthDurableRepository } from "../../../packages/oauth/src/durable-contracts.ts"
import { OAuthAttemptIdSchema, OAuthStateHashSchema, PartnerApplicationIdSchema } from "../../../packages/oauth/src/model.ts"
import { IdentitySchema, OrganizationIdSchema } from "../../../packages/identity/src/model.ts"
import { InMemoryOAuthStateStore, createOAuthStateRecord } from "../../../packages/oauth/src/state.ts"
import { createWebApp } from "./app.ts"
import { OrganizationIdSchema as CopyOrganizationIdSchema, ShopIdSchema as CopyShopIdSchema, type CopyPreviewApiDependencies } from "../../../packages/copy-preview/src/index.ts"
import { OrganizationIdSchema as StagingOrganizationIdSchema, PilotMeasurementCaptureSchema, PilotMeasurementIdSchema, ShopIdSchema, StagingFeatureFlagsSchema, StagingReconciliationSnapshotSchema } from "../../../packages/staging/src/index.ts"
import {
  ExternalOperationAttemptIdSchema,
  OrganizationIdSchema as WriteRecoveryOrganizationIdSchema,
  ShopIdSchema as WriteRecoveryShopIdSchema,
  WriteAttemptIdSchema,
  WriteHashSchema,
  type ExternalOperationAttempt,
} from "../../../packages/write-recovery/src/index.ts"

describe("web runtime health", () => {
  it("serves an honest dashboard shell at the root route", async () => {
    // Given: an independently constructed web runtime.
    const app = createWebApp(createConfiguredDatabaseReadinessProbe(undefined))

    // When: the dashboard route is requested.
    const response = await app.request("/")

    // Then: the operator sees the read-only status surface, not a route error.
    assert.equal(response.status, 200)
    assert.equal(response.headers.get("content-type"), "text/html; charset=UTF-8")
    const html = await response.text()
    assert.match(html, /Shopee Management Dashboard/)
    assert.match(html, /database readiness/i)
    assert.match(html, /Catalog sync/)
    assert.match(html, /OAuth connection/)
  })

  it("identifies the web service when health is requested", async () => {
    // Given: an independently constructed web runtime.
    const app = createWebApp(createConfiguredDatabaseReadinessProbe(undefined))

    // When: its health endpoint is requested.
    const response = await app.request("/health")

    // Then: the observable identifies web, not a generic service.
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { service: "web", status: "ok" })
  })

  it("reports a missing database dependency instead of stale readiness", async () => {
    // Given: a web runtime without configured persistence.
    const app = createWebApp(createConfiguredDatabaseReadinessProbe(undefined))

    // When: readiness is requested.
    const response = await app.request("/ready")

    // Then: the response is unavailable and names the dependency state.
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), {
      service: "web",
      status: "not_ready",
      dependencies: {
        database: { state: "missing", reason: "configuration_missing" },
      },
    })
  })

  it("reports ready after the database probe succeeds", async () => {
    const app = createWebApp(
      createConfiguredDatabaseReadinessProbe("postgresql://db.example/app", {
        probe: async () => {},
      }),
    )

    const response = await app.request("/ready")

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      service: "web",
      status: "ready",
      dependencies: {
        database: { state: "ready", reason: "probe_succeeded" },
      },
    })
  })

  it("wires OAuth start and callback through the provider-free web boundary", async () => {
    // Given: a web app with an injected authenticated OAuth contract.
    const organizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
    const actor = IdentitySchema.parse({ issuer: "https://id.example.test", subject: "web-oauth-owner" })
    const partnerApplicationId = PartnerApplicationIdSchema.parse("partner-web-fixture")
    const stateHash = OAuthStateHashSchema.parse("state-web-fixture-000000000000000000000000000001")
    const stateStore = new InMemoryOAuthStateStore([])
    const durable = new InMemoryOAuthDurableRepository()
    const app = createWebApp(createConfiguredDatabaseReadinessProbe(undefined), undefined, {
      authenticate: () => ({ organizationId, actor }),
      stateStore,
      durable,
      now: () => "2026-09-09T00:00:00.000Z",
      stateLifetimeSeconds: 600,
      nextAttemptId: () => OAuthAttemptIdSchema.parse("40000000-0000-4000-8000-000000000001"),
      hashState: () => stateHash,
      issueState: (input) => ({
        state: "opaque-web-state",
        record: createOAuthStateRecord({
          attemptId: input.attemptId,
          organizationId: input.organizationId,
          actor: input.actor,
          partnerApplicationId: input.partnerApplicationId,
          market: input.market,
          stateHash,
          issuedAt: "2026-09-09T00:00:00.000Z",
          expiresAt: "2026-09-09T00:10:00.000Z",
        }),
      }),
      authorizationUrl: ({ state }) => `https://provider.example.test/oauth?state=${state}`,
    })

    // When: the web route is requested by the authenticated actor.
    const response = await app.request(
      `/api/auth/shopee/start?organizationId=${organizationId}&partnerApplicationId=${partnerApplicationId}&market=ID`,
      { headers: { authorization: "Bearer fixture" } },
    )

    // Then: route wiring returns the provider-free safe authorization projection.
    assert.equal(response.status, 200)
    assert.equal((await response.json() as { data: { state: string } }).data.state, "opaque-web-state")
  })

  it("wires the staging alpha route without enabling mutations", async () => {
    const organizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
    const shopId = ShopIdSchema.parse("30000000-0000-4000-8000-000000000001")
    const featureFlags = StagingFeatureFlagsSchema.parse({
      environment: "staging",
      writePilotEnabled: true,
      capabilityGates: {
        officialProductWrite: "unknown",
        mediaLifecycle: "verified",
        itemCorrelation: "verified",
        variationAtomicity: "verified",
        safeRecovery: "verified",
      },
    })
    const reconciliation = StagingReconciliationSnapshotSchema.parse({
      organizationId,
      shopId,
      collectedAt: "2026-09-09T00:00:00.000Z",
      status: "mismatch",
      expectedDestinationCount: 2,
      observedDestinationCount: 1,
    })
    const app = createWebApp(createConfiguredDatabaseReadinessProbe(undefined), undefined, undefined, {
      authenticate: () => ({ organizationId, accessibleShopIds: [shopId] }),
      read: async () => ({ featureFlags, reconciliation }),
    })

    const response = await app.request(
      `/api/staging/alpha?organizationId=${organizationId}&shopId=${shopId}`,
      { headers: { authorization: "Bearer fixture" } },
    )

    assert.equal(response.status, 200)
    assert.deepEqual((await response.json() as { data: object }).data, {
      organizationId,
      shopId,
      environment: "staging",
      writeGate: { kind: "write_disabled", reason: "capability_unknown" },
      mutationPolicy: "blocked",
      holdControl: { kind: "hold_active", reason: "write_gate_disabled" },
      rollbackControl: { kind: "rollback_ready", action: "disable_write_dispatch" },
      allowedOperations: ["catalog_read", "analytics_read", "copy_preview", "reconciliation_review"],
      blockedOperations: ["media_upload", "product_create", "variation_create"],
    })

    const uiResponse = await app.request(
      `/staging/alpha?organizationId=${organizationId}&shopId=${shopId}`,
      { headers: { authorization: "Bearer fixture" } },
    )
    assert.equal(uiResponse.status, 200)
    const html = await uiResponse.text()
    assert.match(html, /Staging Read-only Alpha/)
    assert.match(html, /Mutation controls are unavailable/)
    assert.doesNotMatch(html, /<form|<button|<script/i)
  })

  it("wires the operator recovery route with explicit scope and no provider call", async () => {
    const organizationId = OrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
    const shopId = ShopIdSchema.parse("30000000-0000-4000-8000-000000000001")
    const attempt: ExternalOperationAttempt = {
      operationAttemptId: ExternalOperationAttemptIdSchema.parse(`external-attempt:${"d".repeat(64)}`),
      organizationId: WriteRecoveryOrganizationIdSchema.parse(organizationId),
      writeAttemptId: WriteAttemptIdSchema.parse(`write-attempt:${"a".repeat(64)}`),
      destinationShopId: WriteRecoveryShopIdSchema.parse(shopId),
      step: "media_upload",
      requestFingerprint: WriteHashSchema.parse("e".repeat(64)),
      state: "outcome_unknown",
      retryAllowed: false,
      outcomeReason: "ack_timeout",
    }
    const app = createWebApp(createConfiguredDatabaseReadinessProbe(undefined), undefined, undefined, undefined, {
      authenticate: () => ({ organizationId: WriteRecoveryOrganizationIdSchema.parse(organizationId), actorId: "actor-owner", accessibleShopIds: [WriteRecoveryShopIdSchema.parse(shopId)], canResolve: true }),
      list: async () => [attempt],
      find: async () => attempt,
      resolve: async ({ attempt: current }) => ({ ...current, state: "reauth_required", outcomeReason: "reauth_required:actor-owner" }),
    })
    const response = await app.request(`/api/write-recovery/outcome-unknown?organizationId=${organizationId}&shopId=${shopId}`, { headers: { authorization: "Bearer fixture" } })
    assert.equal(response.status, 200)
    assert.equal((await response.json() as { data: { attempts: readonly ExternalOperationAttempt[] } }).data.attempts.length, 1)
  })

  it("wires the pilot measurement route without enabling provider mutations", async () => {
    const organizationId = StagingOrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
    const measurementId = PilotMeasurementIdSchema.parse("80000000-0000-4000-8000-000000000001")
    const capture = PilotMeasurementCaptureSchema.parse({
      organizationId,
      capturedAt: "2026-09-10T00:00:00.000Z",
      workflow: "multi_store_product_management",
      baselineMinutes: 30,
      observedMinutes: 12,
      sampleCount: 10,
      targetReductionPercent: 50,
    })
    const app = createWebApp(createConfiguredDatabaseReadinessProbe(undefined), undefined, undefined, undefined, undefined, {
      authenticate: () => ({ organizationId, actorId: "owner-1", canRead: true, canCapture: true }),
      repository: {
        saveMeasurement: async () => undefined,
        readMeasurement: async () => ({ measurementId, capture, outcome: { kind: "target_met", reductionPercent: 60, targetReductionPercent: 50 } }),
      },
      nextMeasurementId: () => measurementId,
    })
    const response = await app.request(`/api/staging/pilot-measurements?organizationId=${organizationId}&measurementId=${measurementId}`, { headers: { authorization: "Bearer fixture" } })
    assert.equal(response.status, 200)
    assert.equal((await response.json() as { data: { measurementId: string } }).data.measurementId, measurementId)
  })

  it("wires the copy-preview route without enabling mutations", async () => {
    const organizationId = CopyOrganizationIdSchema.parse("10000000-0000-4000-8000-000000000001")
    const sourceShopId = CopyShopIdSchema.parse("30000000-0000-4000-8000-000000000001")
    const destinationShopId = CopyShopIdSchema.parse("30000000-0000-4000-8000-000000000002")
    const dependencies: CopyPreviewApiDependencies = {
      authenticate: () => ({ organizationId, accessibleShopIds: [sourceShopId, destinationShopId] }),
      sourceSnapshots: {
        loadCanonicalSourceSnapshot: async () => ({
          organizationId,
          sourceShopId,
          sourceProductId: "source-product-1",
          capturedAt: "2026-09-09T00:00:00.000Z",
          completeness: "complete",
          title: "Product title",
          description: "Safe source description",
          categoryId: "source-category",
          attributes: { color: "blue" },
        }),
      },
    }
    const app = createWebApp(createConfiguredDatabaseReadinessProbe(undefined), undefined, undefined, undefined, undefined, undefined, dependencies)
    const response = await app.request("/api/copy-preview", {
      method: "POST",
      headers: { authorization: "Bearer fixture", "content-type": "application/json" },
      body: JSON.stringify({
        source: {
          organizationId,
          sourceShopId,
          sourceProductId: "source-product-1",
          capturedAt: "2026-09-09T00:00:00.000Z",
          completeness: "complete",
          title: "Product title",
          description: "Safe source description",
          categoryId: "source-category",
          attributes: { color: "blue" },
        },
        destinations: [{
          requirement: {
            organizationId,
            destinationShopId,
            capturedAt: "2026-09-09T00:01:00.000Z",
            completeness: "complete",
            allowedCategoryIds: ["target-category"],
            requiredAttributes: ["color"],
            maximumTitleLength: 120,
          },
          mapping: { destinationCategoryId: "target-category" },
        }],
      }),
    })
    assert.equal(response.status, 200)
    assert.equal((await response.json() as { data: { previews: readonly unknown[] } }).data.previews.length, 1)
  })
})
