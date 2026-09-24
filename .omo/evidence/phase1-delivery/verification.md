# Phase 1 delivery/outbox verification

Evidence date: 2026-09-09
Environment: local Windows workspace; no PostgreSQL, Shopee credentials, real DB, or external writes
Scope: `packages/delivery/**`, `db/migrations/0002_delivery.sql`, and delivery evidence only

## Targeted source tests

Invocation:

```text
node --experimental-strip-types --test packages/delivery/src/contracts.test.ts packages/delivery/src/delivery.test.ts packages/delivery/src/recovery.test.ts
```

Binary observable: exit 0; 12 tests passed, 0 failed, 0 cancelled, 0 skipped.

Covered scenarios and observable assertions:

| Scenario | Observable |
| --- | --- |
| malformed input | scalar payload and malformed identity are rejected; sensitive key is rejected without reflecting its value |
| duplicate outbox dispatch | second dispatch returns `duplicate` and the original job ID |
| stale lease fencing | reclaimed generation rejects the stale worker commit |
| interruption/recovery | expired lease is reclaimed by worker B and commits `COMPLETED` with attempt count 2 |
| lost acknowledgement/redelivery | committed job returns `terminal_noop` and is not re-executed |
| scheduler collision | same organization/task/target/slot returns `created` then `duplicate` |
| poison dead-letter replay | replay creates a new pending job referencing the immutable command/dead letter |
| replay idempotency | repeated replay returns the first replay job |

## Bounded manual CLI

Invocation:

```text
node --experimental-strip-types packages/delivery/src/manual-queue.ts
```

Binary observable: exit 0; JSON stdout contained 12 transitions, `semantics: at-least-once`, and `malformedInput: rejected`.

Captured artifact: `.artifacts/phase1/delivery/manual-queue.json`

Artifact validation invocation:

```text
Get-Content -Raw .artifacts\\phase1\\delivery\\manual-queue.json | ConvertFrom-Json
```

Binary observable: JSON parsed successfully, transition count was 12, and all required steps were present: `duplicate_dispatch`, `stale_lease_commit`, `lost_ack_redelivery`, `scheduler_collision`, `poison_replay`, and `interruption_recovery`.

The managed filesystem rejected runtime Node writes with `EBADF` and PowerShell redirection to the artifact path with access denied. The artifact therefore records the exact successful CLI stdout through the workspace patch surface; the CLI itself remains bounded and stdout-based. No external state was touched.

## Migration presence/invariant check

Invocation: PowerShell string checks over `db/migrations/0002_delivery.sql`.

Binary observable: all checks were `True`: `delivery_commands`, `outbox_events`, `queue_jobs`, `scheduled_triggers`, `dead_letter_jobs`, unique `outbox_event_id`, unique organization/task/target/slot, claim-ready index, expired-lease index, and replay dead-letter foreign key.

## Tooling limitation

Invocation: `pnpm run typecheck`

Observed result: pnpm failed before invoking `tsc` because the managed dependency state could not open `_tmp_11360_3e148624e74f912e839357d4e94fc73d` (`ENOENT`, pnpm exit `4294963238`). No local `node_modules/.bin/tsc` or Biome binary was available, so repository typecheck/lint could not be truthfully claimed. The direct Node test/parser gate above passed.

## Cleanup and semantics

The manual store is process-local and discarded on exit. The delivery contract is explicitly at-least-once; no exactly-once Shopee write claim is made. No real DB, Shopee API, credentials, or external writes were used.
