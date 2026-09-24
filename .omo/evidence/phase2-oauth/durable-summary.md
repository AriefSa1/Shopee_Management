# Phase 2 OAuth durable contract slice

This bounded provider-free slice defines repository contracts for OAuth attempts, grants, credential subjects, KMS envelope metadata, and refresh/rotation recovery. The in-memory implementation is a deterministic contract fixture only; it does not connect to PostgreSQL, KMS, Shopee, or the network.

## Verification

- RED: `node --experimental-strip-types --test packages/oauth/src/durable-contracts.test.ts` failed with `ERR_MODULE_NOT_FOUND` for the intentionally absent implementation module.
- GREEN: `node --experimental-strip-types --test packages/oauth/src/durable-contracts.test.ts` passed 4/4, including runtime-only callback-field omission.
- Combined OAuth regression: `node --experimental-strip-types --test packages/oauth/src/durable-contracts.test.ts packages/oauth/src/oauth-contracts.test.ts packages/oauth/src/oauth-state-time.test.ts` passed 17/17.
- Manual QA: `node --experimental-strip-types packages/oauth/src/manual-oauth-durable.ts` exited 0 and produced `.artifacts/phase2/oauth/manual-oauth-durable.json`.
- Manual assertions: organization-owned attempt persisted, unknown refresh outcome returned `reauth_required`, secret fields absent, network/database/KMS calls all zero.

## Scope and remaining gates

The slice does not claim durable PostgreSQL persistence, KMS-backed envelope operations, OAuth route wiring, worker deployment, provider exchange, token refresh against Shopee, migration execution, or staging validation. Production write and refresh behavior remains disabled until official capability evidence and infrastructure gates are complete.
