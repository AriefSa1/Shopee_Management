# Phase 5 copy-preview persistence evidence

Status: `confirmed_bounded_slice`.

The provider-free persistence contract stores an organization-scoped immutable preview projection and its stable copy intent in one transaction. Reads require both organization and destination-shop scope. The preview remains `preview_only`; no Shopee mutation, confirmation, outbox dispatch, KMS, or live database operation is performed.

Verification:

- `node --experimental-strip-types --test packages/copy-preview/src/postgres-copy-preview.test.ts`: 3 passed, 0 failed.
- `node --experimental-strip-types packages/copy-preview/src/manual-postgres-copy-preview.ts`: exit 0; output matches `.artifacts/phase5/copy-preview/manual-postgres-copy-preview.json`.
- New persistence/manual files pass `node --experimental-strip-types --check`.
- Migration `0008_copy_preview.sql` uses composite organization/shop ownership FKs and has no token, callback, or authorization-header columns.
- The migration hardening binds `copy_intents` to the same destination shop as its active preview through a composite `(organization_id, destination_shop_id, preview_hash)` uniqueness/FK contract.

Not proven: live PostgreSQL constraints/rollback/concurrency, production auth/RBAC, durable API/worker wiring, confirmation/outbox fencing, official Shopee product-write capability, and staging/deployment.
