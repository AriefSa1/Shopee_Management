# PostgreSQL delivery contract follow-up

Evidence date: 2026-09-09
Scope: `packages/delivery/**`, `db/migrations/0002_delivery.sql`, and delivery evidence only

## Dependency-injected SQL repository

Implemented `PostgresDeliveryRepository` over a typed `PostgresExecutor` contract. Repository statements are parameterized and transaction-scoped. The contract includes:

- outbox row lock, queue insert, `ON CONFLICT (outbox_event_id) DO NOTHING`, and dispatched marking in one transaction;
- queue claim with organization/job scope, `FOR UPDATE SKIP LOCKED`, available-time check, expired-lease reclaim, lease owner, and fencing generation;
- commit and acknowledgement guarded by the current organization/job lease generation;
- scheduler advisory transaction lock plus unique `(organization_id, task_name, target_key, slot_at)` conflict handling;
- dead-letter transition guarded by the current lease and replay through a new queue job referencing the immutable command/dead-letter row.

## Deterministic simulated executor evidence

Invocation:

```text
node --experimental-strip-types --test packages/delivery/src/postgres-delivery.test.ts
```

Binary observable: exit `0`; 5 tests passed, 0 failed, 0 cancelled, 0 skipped.

The fake executor clones transactional state and commits only after the callback resolves. The tests assert actual statement names, parameter-scoped behavior, generated row transitions, and SQL clauses. Covered scenarios:

| Scenario | Binary observable | Artifact |
| --- | --- | --- |
| atomic outbox-to-queue | first dispatch is `dispatched`, second is `duplicate`, fake job count is `1`, insert contains outbox conflict clause | `.artifacts/phase1/delivery/postgres-contract.json` |
| organization scope and dedupe | wrong organization cannot see the event; migration contains org/dedupe and composite foreign-key constraints | `.artifacts/phase1/delivery/postgres-contract.json` |
| current-time lease fencing | live lease rejects; claim after expiry returns generation `2`; claim SQL contains `FOR UPDATE SKIP LOCKED` | `.artifacts/phase1/delivery/postgres-contract.json` |
| UUID scheduler identity | same slot returns the first UUID as `duplicate`; SQL uses advisory lock and unique-slot conflict | `.artifacts/phase1/delivery/postgres-contract.json` |
| DLQ replay | replay returns one queue job with the original command and dead-letter reference | `.artifacts/phase1/delivery/postgres-contract.json` |

Captured summary artifact: `.artifacts/phase1/delivery/postgres-contract.json`.

## Live PostgreSQL boundary

Live PostgreSQL integration was not run. No `DATABASE_URL`, `.env`, credentials, external service, or real database was read or used. The fake executor proves repository transaction/SQL contract behavior only; it does not prove PostgreSQL planner, lock scheduling, grants, or wire-driver behavior. A live isolated PostgreSQL integration gate remains required before claiming database integration completion.

## Combined delivery regression gate

Invocation:

```text
node --experimental-strip-types --test packages/delivery/src/contracts.test.ts packages/delivery/src/delivery.test.ts packages/delivery/src/recovery.test.ts packages/delivery/src/postgres-delivery.test.ts
```

Binary observable: exit `0`; 17 tests passed, 0 failed, 0 cancelled, 0 skipped.

The pre-existing bounded manual CLI also passed:

```text
node --experimental-strip-types packages/delivery/src/manual-queue.ts
```

Its artifact remains `.artifacts/phase1/delivery/manual-queue.json` and records 12 required at-least-once transitions.

## Tooling limitation

`pnpm run typecheck` remains unavailable in this managed workspace: pnpm fails before invoking `tsc` with `ENOENT` for its temporary dependency path, and no local `tsc` or Biome binary is installed. This follow-up therefore claims direct Node parser/test evidence and simulated SQL contract evidence, not a repository-wide typecheck/lint pass.
