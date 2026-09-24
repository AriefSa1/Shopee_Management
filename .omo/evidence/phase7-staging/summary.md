# Phase 7 Read-Only Staging Contract

## Scope

This evidence covers only a deterministic, provider-free operational contract for staging and the read-only alpha. It does not enable a write pilot, contact Shopee, read credentials, access a database, or deploy an environment.

## Red proof

Invocation:

```powershell
node --experimental-strip-types --test packages/staging/src/staging.test.ts
```

Before implementation, Node exited nonzero because `packages/staging/src/index.ts` did not exist. Observable result: `ERR_MODULE_NOT_FOUND`, 0 passing tests, 1 failed test file.

## Green proof

Invocation:

```powershell
node --experimental-strip-types --test packages/staging/src/staging.test.ts
```

Observable result: exit 0; the current combined staging suite reports 9 passing tests; 0 failures, cancellations, skips, or todos. The tested scenarios cover five API boundary cases, write-gate/hold behavior, reconciliation mismatch handling, and a captured 30-minute-to-12-minute observation evaluating to 60% reduction against a 50% target.

## Manual QA

Invocation:

```powershell
node --experimental-strip-types packages/staging/src/manual-staging.ts
```

Observable result: exit 0 and the captured artifact at `.artifacts/phase7/staging/manual-staging.json`. It reports `write_disabled` with `capability_unknown`, `mutationPolicy:"blocked"`, an active hold, a rollback action limited to disabling future dispatch, 60% measured reduction, and zero network/database/Shopee mutations with no secret fields.

## Read-only API boundary

The provider-free staging API boundary is implemented in `packages/staging/src/staging-api.ts` and exported from `packages/staging/src/index.ts`. Independent verification ran:

```powershell
node --experimental-strip-types --test packages/staging/src/staging.test.ts packages/staging/src/staging-api.test.ts
```

Result: exit 0; 9 passing tests; 0 failures, skips, cancellations, or todos. The boundary rejects unauthenticated requests before state reads, enforces organization and accessible-shop scope, verifies the returned reconciliation `shopId`, maps malformed requests to 400, missing state to 404, and state-reader failures to a safe retryable 502. A direct adversarial probe covered statuses `[401, 400, 404, 403, 502]` with `externalCalls: 0`.

The API remains provider-free and read-only: the workflow exposes `write_disabled`/`capability_unknown`, `mutationPolicy:"blocked"`, an active hold, rollback limited to `disable_write_dispatch`, and only read/review operations. `apps/web/src/app.ts` now conditionally mounts `GET /api/staging/alpha`, and `StagingReconciliationSnapshot` requires an explicit `shopId` that the handler matches against the request. The application entrypoint composes a fail-closed dependency boundary until production actor/session and state-reader authorities are available.

## Web composition boundary

`apps/web/src/main.ts` now injects `createFailClosedStagingDependencies()`. This composition deliberately authenticates no actor and returns no staging state, so the running process cannot fabricate organization/shop authority or expose a mutation path. The route therefore remains unavailable to unauthenticated callers until a real server-side session/state composition is provided. The injected route test and worker health suite pass 6/6 when resolved through the external pnpm virtual-store loader; standard workspace dependency installation remains unavailable.

## Validation limitation

`pnpm run typecheck` and `pnpm exec biome check packages/staging/src` could not start in this managed workspace because pnpm attempted an internal install and could not create its `_tmp_*` file. A direct TypeScript run through the external virtual store reports pre-existing repository contract errors, while the new Phase 7 PostgreSQL files are clean under that check. These are validation-environment/repository limitations, not passing checks. Focused tests and manual CLIs ran successfully without a package install.

## Remaining Phase 7 gates

Full staging/alpha/pilot remains gated on user-approved credentials, deployment, costs, official capability evidence, durable PostgreSQL/KMS/grant tests, production session/authentication and state-reader composition, write-worker implementation, and an explicit pilot authorization. This slice intentionally provides no write adapter or external mutation dispatch.
