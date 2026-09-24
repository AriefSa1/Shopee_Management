# Phase 3 catalog API boundary

The read-only HTTP boundary is implemented as `createCatalogApiHandler` and mounted at `/api/catalog` when web dependencies provide a catalog adapter.

- Authentication is required through a bearer request plus injected authenticated context.
- Organization and shop scope are checked before provider invocation.
- Query input is parsed with Zod; malformed requests return `invalid_catalog_request`.
- Responses preserve completeness, freshness filtering, numeric zero, and provider-safe error codes.
- The adapter remains provider-fixture only. No Shopee network, database, credentials, or mutation path is enabled.

Focused test command: `node --experimental-strip-types --test packages/catalog/src/catalog-api.test.ts` -> 3 passed, 0 failed.
Manual command: `node --experimental-strip-types packages/catalog/src/manual-catalog-api.ts` -> status 200, complete fixture, zero-stock preserved, network/database/Shopee mutations 0, secret fields false.

Remaining gates: official Shopee capability verification, PostgreSQL persistence, production authentication integration, UI deployment, and write/copy confirmation/outbox flow.
