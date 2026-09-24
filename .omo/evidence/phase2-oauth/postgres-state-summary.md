# Phase 2 OAuth PostgreSQL state contract

This is a bounded, provider-free contract slice for organization-scoped OAuth state persistence. It verifies the repository and migration contract using the deterministic fake PostgreSQL executor. It does not claim a live PostgreSQL connection or production OAuth persistence.

## Verification

- Focused test: `node --experimental-strip-types --test packages/oauth/src/postgres-state.test.ts` passed **5/5**, failed **0**.
- Manual QA: `node --experimental-strip-types packages/oauth/src/manual-postgres-state.ts` exited **0** and produced `.artifacts/phase2/oauth/manual-postgres-state.json`.
- Manual assertions: `claimKind=claimed`, `rowLock=true`, `callbackCodePersisted=false`, and `organizationScoped=true`.
- Safety counters: `networkCalls=0`, `databaseCalls=0`, `kmsCalls=0`, `shopeeMutations=0`, and `secretFieldsPresent=false`.

## Contract coverage

- Persisted state is organization-scoped and uses `(organization_id, state_hash)` as the durable key.
- Callback claiming is organization- and actor-bound and uses an explicit `FOR UPDATE` row lock in the repository contract.
- A callback code is returned only in memory after a successful claim; it is not a SQL parameter or migration column.
- Replay, organization substitution, actor substitution, and expiry fail closed without claiming the state.

## Remaining gates

This evidence does not prove live PostgreSQL migration execution, grants, transaction behavior, locking under concurrency, or recovery against a real PostgreSQL instance. KMS-backed envelope storage, official provider exchange/refresh, OAuth route deployment, worker deployment, staging validation, and production credential review remain open. No callback code, token, secret, cookie, or PII is included in this artifact.
