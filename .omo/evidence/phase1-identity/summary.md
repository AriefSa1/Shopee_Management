# Phase 1 identity and audit evidence

## Manual RBAC surface

- Scenario: bounded manual authorization QA with seven deterministic scenarios, malformed boundary probes, and cleanup counters.
- Invocation: `node --experimental-strip-types packages/identity/src/manual-rbac.ts` with a 3000 ms process bound.
- Binary observable: exit `0`; stdout contains one JSON object; stderr is empty; the object has `passed: true`, seven passed scenarios, and `temporaryResourcesRemaining: 0`.
- Captured artifact: `.artifacts/phase1/identity/manual-rbac.json`.
- Artifact parse: `node -e "JSON.parse(fs.readFileSync(...))"` exited `0` and observed `passed: true`, `scenarioCount: 7`, malformed role and identity rejection, stale revision denial, forged organization/shop denial, and no misleading success log.

The original manual command was bounded at 3000 ms and produced no output/artifact. Phase markers localized the stall to the promise-based filesystem write; Node and PowerShell writes under this managed artifact path return `ENOENT`. The entrypoint is therefore a stdout-only deterministic manual QA surface. The required artifact was materialized from that exact JSON output and parsed independently.

## Authorization and audit tests

- Invocation: `node --experimental-strip-types --test packages/identity/src/authorize.test.ts packages/identity/src/boundary.test.ts packages/identity/src/migration-contract.test.ts packages/audit/src/audit-event.test.ts`.
- Binary observable: exit `0`; `tests 12`, `pass 12`, `fail 0`, `suites 4`.
- Covered scenarios: revoked membership denial, Staff publication denial, cross-organization shop denial, stale authorization revision denial, malformed permission and identity boundary rejection, and audit credential-like field rejection. The suite also covers Admin recovery approval and forged organization denial.

## Migration organization-boundary tests

- Scenario: inspect `db/migrations/0001_identity.sql` for organization-scoped audit subject shops and hostile mutation paths without a database.
- Invocation: `node --experimental-strip-types --test packages/identity/src/migration-contract.test.ts` (also included in the combined identity/audit command).
- Binary observable: exit `0`; 2 migration tests passed, 0 failed.
- Verified: the old unscoped `subject_shop_ids uuid[]` is absent; `audit_event_shops` has composite `(organization_id, shop_id)` and `(event_id, organization_id)` foreign keys; non-authorization child rows are rejected; parent and child update/delete paths are append-only guarded.
- Captured artifact: `.artifacts/phase1/identity/migration-contract.json`.
- A temporary PostgreSQL validation was attempted without `.env` or existing databases. `pg_ctl.exe` failed before startup with `could not create restricted token: error code 87`; the temporary cluster directory was removed and no server remained.

## Source validation

- Invocation: `node --experimental-strip-types --check packages/identity/src/manual-rbac.ts`.
- Binary observable: exit `0`.
- `pnpm exec tsc --noEmit` and `pnpm exec biome check packages/identity packages/audit` were attempted. Both were blocked before tool execution because pnpm attempted an install and the managed filesystem rejected `_tmp_*` with `ENOENT`; direct `tsc`/`biome` binaries are not installed. This is an environment gap, not an assertion failure.
- The TypeScript no-excuse checker was also attempted and exited `2` because the project cannot resolve the unavailable `typescript` package.

## Scope and cleanup

- Changed implementation: `packages/identity/src/manual-rbac.ts`, `packages/identity/src/migration-contract.test.ts`, and `db/migrations/0001_identity.sql`; authorization and audit API logic were preserved.
- Evidence: `.omo/evidence/phase1-identity/summary.md`, `.omo/evidence/phase1-identity/debug-journal.md`, `.artifacts/phase1/identity/manual-rbac.json`, `.artifacts/phase1/identity/migration-contract.json`.
- No DB, Shopee API, credentials, temporary external resources, or live mutations were used.
