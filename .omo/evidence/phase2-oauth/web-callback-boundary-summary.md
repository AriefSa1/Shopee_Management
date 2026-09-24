# Phase 2 provider-free OAuth web callback boundary

The bounded web contract covers authenticated authorization start and callback handling without making provider, network, database, KMS, cookie, or worker exchange calls.

- `oauth-api.test.ts`: 5/5 focused tests passed, including same-actor foreign-organization denial.
- `manual-oauth-api.ts`: start `200`, callback `202`, replay `409`.
- Manual artifact: `.artifacts/phase2/oauth/manual-oauth-api.json`.
- Callback response is a safe worker-pending projection; raw callback code is not persisted or returned.
- State is organization and actor bound; expiry, replay, and actor substitution are denied.
- Callback receipt time is derived from the injected server clock; client-supplied `receivedAt` is not part of the request schema.
- Authorization-state timestamps are supplied from the injected server clock and state issuer; the handler contains no epoch placeholder.
- `apps/web/src/app.ts` exposes `/api/auth/shopee/start` and `/api/auth/shopee/callback` only when an injected provider-free dependency contract is supplied.

Production route/session/redirect wiring, durable PostgreSQL claim locking, KMS envelope handling, official authorization URL/signing behavior, and worker exchange remain explicit deployment and capability gates. No live Shopee call or external mutation is enabled by this slice.
