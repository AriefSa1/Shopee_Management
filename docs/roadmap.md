# Roadmap dan Phase Gates

Purpose: mengurutkan delivery MVP dan external capability gates. Status: approved planning roadmap. Owner: Product/Technical Lead. Approval gate: Phase 0 traceability and each exit gate.

## Phase 0: baseline

Final PRD, acceptance, capability matrix, pilot method, owners, and unresolved register. Execution remains planning-only until required host consensus/execution receipt is available.

## Phase 1: foundation

OIDC/org/RBAC, migrations, separate web/worker/migration/readonly identities, PostgreSQL outbox/jobs/scheduler, safe telemetry/audit, package boundaries. Gate: actual allow/deny, queue crash prototype, fail-closed config.

## Phase 2: OAuth and credential subjects

State/callback command, worker-only exchange/refresh, grant/subject/shop binding, encryption/partner-key policies, rotation recovery. Gate: signing requirement, subject lineage, replay, rotation crash, and auth/refresh rate scope evidence.

## Phase 3: catalog

Per-shop product/variant sync, pagination/completeness, filters, freshness, limiter registry. Gate: field/permission/pagination/rate evidence.

## Phase 4: analytics

Metric definitions, collection runs/snapshots, comparison rules, absence semantics, UI. Gate: supported field/window/as-of evidence and zero/absence tests.

## Phase 5: local copy preview

Source/requirements snapshots, stable intent, serialization/supersede, mapper/validator/hash, per-destination UI. Zero mutating adapter. Gate: 10 previews, 7/3 validation pressure, zero upstream mutation, stale rejection.

## Pre-write gate

Verify MediaSpace lifecycle, add-item response/correlation, visibility/draft behavior, variation atomicity, safe repair, supported shapes, and all rate scopes. Recovery/runbooks and crash/revocation/supersede tests pass; Product, Architecture, Security, Test/Verifier, and Shopee lead approve.

## Phase 6: confirmed write

Enable only verified MediaSpace/add-item/variation adapters, attempts, publication and recovery UI. Gate: 7-valid/3-invalid, all crash boundaries, no duplicate create, no blind unknown retry, supported shapes only.

## Phase 7: staging, alpha, pilot

Staging capability evidence, read-only alpha, feature-flagged narrow write pilot, backup/restore/rollback drills, baseline freeze, then 30-day measurement.

## Four watch clarifications

These are explicit gates, not implementation assumptions:

1. **Token-exchange executor**: name `shopee-worker` and prove exact partner-key/local-encryption permission boundary.
2. **Stable copy intent**: serialize superseding command versions and reject stale generation/started-attempt supersede.
3. **Hierarchical rate limits**: enforce partner/global, credential subject, shop, and endpoint scopes; unknown is conservative.
4. **PostgreSQL delivery terminology**: outbox uses row locks; queue jobs use leases/fencing; commit happens before ack.
