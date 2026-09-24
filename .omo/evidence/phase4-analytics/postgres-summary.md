# Phase 4 analytics persistence evidence

Status: `confirmed_bounded_slice`.

This is a provider-free PostgreSQL repository contract. It stores metric definition metadata, scoped collection runs, ordered product snapshots, explicit value/absence states, and freshness/cursor evidence. The fake executor proves transaction shape and organization/shop scoping without contacting Shopee, KMS, a live database, or any external service.

Verification:

- `node --experimental-strip-types --test packages/analytics/src/postgres-analytics.test.ts packages/analytics/src/analytics.test.ts packages/analytics/src/analytics-api.test.ts`: 19 passed, 0 failed.
- `node --experimental-strip-types packages/analytics/src/manual-postgres-analytics.ts`: exit 0; output matches `.artifacts/phase4/analytics/manual-postgres-analytics.json`.
- The collection builder now downgrades a page-complete run to `partial` when a requested product is `not_returned`, preventing a contradictory complete run.
- Migration `0007_analytics.sql` retains nullable metric values, explicit state checks, composite organization/shop/run ownership, and no credential or callback-code columns.

Not proven by this slice: live PostgreSQL parsing/constraints/locking/grants/rollback/concurrency, immutable-definition enforcement by the deployed schema, official Shopee analytics capability or pagination, KMS, worker/API durable wiring, staging, deployment, and production access review.
