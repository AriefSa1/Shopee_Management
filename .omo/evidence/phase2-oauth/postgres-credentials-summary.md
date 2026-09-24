# Phase 2 OAuth credential subject persistence contract

This is a bounded, provider-free contract slice for organization-scoped credential-subject, encrypted-envelope metadata, and shop-binding persistence. It uses a deterministic fake PostgreSQL executor and accepts only an already-encrypted envelope. It does not claim live PostgreSQL, KMS, official Shopee exchange/refresh, or production OAuth readiness.

## Verification

- Focused test: `node --experimental-strip-types --test packages/oauth/src/postgres-credentials.test.ts` passed **5/5**, failed **0**.
- Manual QA: `node --experimental-strip-types packages/oauth/src/manual-postgres-credentials.ts` exited **0** and produced `.artifacts/phase2/oauth/manual-postgres-credentials.json`.
- Manual assertions: organization scope, composite shop binding, revision fencing with `FOR UPDATE`, and `outcome_unknown` to `reauth_required` all passed.
- Safety counters: network, database, Shopee mutation, KMS, and external writes are all `0`; `secretFieldsPresent=false`.

## Contract coverage

- `0005_credentials.sql` stores only encrypted envelope metadata (`algorithm`, key version, ciphertext) and safe subject state; no plaintext access token, refresh token, callback code, or raw-secret column exists.
- Subject reads and refresh outcomes are organization-scoped. Rotation is fenced by the expected revision and the row-lock contract.
- An unknown refresh outcome marks the subject and its active shop bindings `reauth_required`; envelope reads fail closed afterward.
- Shop bindings use organization-scoped composite foreign keys to both `shop_connections` and `credential_subjects`.

## Remaining gates

This evidence does not prove migration execution against live PostgreSQL, real transaction/locking/concurrency behavior, grants, KMS encryption-context enforcement, official provider exchange/refresh, OAuth route or worker deployment, staging validation, or production credential review. The slice intentionally does not enable Shopee writes.
