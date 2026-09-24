# Phase 6 write-recovery persistence evidence

Status: `confirmed_bounded_slice`.

This provider-free persistence contract stores a write command projection, per-destination attempts, and safe state transitions including `outcome_unknown` and `reauth_required`. Command metadata is passed explicitly by the caller; no actor, intent, payload, or preview value is fabricated inside the repository. The migration keeps organization/shop ownership and rejects raw credential/header fields. The provider adapter remains disabled.

Verification:

- `node --experimental-strip-types --test packages/write-recovery/src/postgres-write-recovery.test.ts packages/write-recovery/src/recovery.test.ts`: 12 passed, 0 failed.
- `node --experimental-strip-types packages/write-recovery/src/manual-postgres-write-recovery.ts`: exit 0; semantic JSON output matches `.artifacts/phase6/write-recovery/manual-postgres-write-recovery.json` and includes persisted `outcome_unknown`.
- New repository, fake executor, test, and manual files pass `node --experimental-strip-types --check`.
- `0009_write_recovery.sql` uses composite organization/shop FKs, terminal-state dispatch checks, trigger-protected append-only recovery decisions, and decision-kind/reason/provider-reference checks. The repository persists recovery decisions, requires `RETURNING` evidence for affected-row updates, and refuses terminal-attempt reopening.
- `0010_external_operation_attempts.sql` and the repository external-operation methods persist per-step (`media_upload`, `item_create`, `variation_init`, `publication`) request fingerprints and state transitions. The provider-free fake test proves `prepared -> sent -> outcome_unknown`, rejects a blind `outcome_unknown -> sent` retry, and permits only explicit resolution states.
- `node --experimental-strip-types packages/write-recovery/src/manual-external-operation.ts`: exit 0; semantic JSON output matches `.artifacts/phase6/write-recovery/manual-external-operation.json`, with `outcomeUnknownPersisted=true`, retry disabled, and all external-effect counters zero.
- `packages/write-recovery/src/recovery-api.ts` exposes a provider-free operator boundary for listing and resolving `OUTCOME_UNKNOWN` attempts. Its route filters organization/shop scope, requires explicit recovery permission, binds `operatorId` to the authenticated actor, and never accepts client-supplied actor identity. Focused API/app wiring tests pass 11/11; `manual-recovery-api.ts` exits 0 and matches `.artifacts/phase6/write-recovery/manual-recovery-api.json` semantically.

Not proven: live PostgreSQL enforcement/rollback/locking/grants, KMS and credential subject integration, durable confirmation/outbox worker integration, deployed worker, official Shopee capabilities, real provider operations, staging, and human authorization to enable writes. Provider-free command/outbox composition is covered separately by `packages/write-recovery/src/confirmed-dispatch.ts` and its focused tests.
