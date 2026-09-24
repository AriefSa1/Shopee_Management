# Phase 4 analytics API boundary

The bounded read-only API contract is implemented in `packages/analytics/src/analytics-api.ts` and exported from the analytics package.

Verification:

- `node --experimental-strip-types --test packages/analytics/src/analytics-api.test.ts packages/analytics/src/analytics.test.ts` -> 12 passed, 0 failed.
- `node --experimental-strip-types packages/analytics/src/manual-analytics-api.ts` -> HTTP 200, explicit metric value `0`, `networkCalls: 0`, `databaseCalls: 0`, `shopeeMutations: 0`, `secretFieldsPresent: false`, `writeEnabled: false`.

Boundary behavior includes bearer authentication, organization and accessible-shop checks, Zod query parsing, safe provider error mapping, product-not-found handling, zero/missing/unsupported/not-returned/stale projection, and comparison ineligibility for incomplete or absent data.

Production gaps remain: durable PostgreSQL collection reads, real identity/session verification, official Shopee capability evidence, and deployed route wiring/staging validation. No Shopee write or external network path is present in this slice.
