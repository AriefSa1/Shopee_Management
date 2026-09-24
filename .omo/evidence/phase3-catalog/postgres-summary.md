# Phase 3 catalog PostgreSQL persistence contract

This is a bounded, provider-free catalog persistence slice. It stores collection runs, products, and variants under organization/shop scope using a deterministic fake PostgreSQL executor. It preserves explicit incomplete-run evidence and numeric zero versus not-returned stock. It does not claim live PostgreSQL, official Shopee pagination, or production catalog synchronization.

## Verification

- Focused test: `node --experimental-strip-types --test packages/catalog/src/postgres-catalog.test.ts` passed **6/6**, failed **0**.
- Syntax checks for repository, fake executor, test, and manual probe passed.
- Manual probe: `node --experimental-strip-types packages/catalog/src/manual-postgres-catalog.ts` exited **0** and emitted the bounded result recorded in `.artifacts/phase3/catalog/manual-postgres-catalog.json`.
- Safety counters: network, database, Shopee mutation, KMS, and external writes are all `0`; `secretFieldsPresent=false`.

## Contract coverage

- `0006_catalog.sql` uses organization/shop composite foreign keys to `shop_connections` and nullable stock constraints.
- Product and variant rows round-trip under a collection run without changing `0` into missing or inventing stock for `NULL`.
- Collection scope is enforced on reads; incomplete pagination evidence remains incomplete and does not imply deletion.
- Empty collections round-trip without inventing a product row.
- The repository uses one transaction boundary and parameterized, shop-scoped SQL. No raw upstream payload or credential field is persisted.

## Remaining gates

Live migration/FK/grant/rollback/concurrency validation, durable catalog sync worker integration, official Shopee pagination/rate-limit capability evidence, authenticated application wiring, deployment, and production staging remain open.
