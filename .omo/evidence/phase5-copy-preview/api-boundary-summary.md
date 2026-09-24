# Phase 5 copy-preview API boundary

The bounded API contract is implemented in `packages/copy-preview/src/copy-preview-api.ts`.

- `POST /api/copy-preview` requires a Bearer header and an authenticated organization context.
- Source and every destination shop must be in the authenticated organization scope.
- Request bodies are parsed once with the copy-preview Zod schema.
- The response contains per-destination previews, deterministic hashes, validation outcomes, and a read-only adapter projection.
- No database, network, Shopee, cookie, token, or secret access exists in this boundary.
- Pre-confirmation mutation remains structurally disabled with `preConfirmationShopeeMutationTotal: 0`.

Focused verification:

`node --experimental-strip-types --test packages/copy-preview/src/copy-preview.test.ts packages/copy-preview/src/copy-preview-api.test.ts` -> 10 passed, 0 failed.

Manual verification:

`node --experimental-strip-types packages/copy-preview/src/manual-copy-preview-api.ts` -> status 200, one valid preview, read-only adapter, zero network/database/Shopee mutations, no secret fields. Output is captured at `.artifacts/phase5/copy-preview/manual-copy-preview-api.json`.

This is a pre-write fixture/API slice. PostgreSQL persistence, production authentication/session verification, official Shopee capability evidence, confirmation workflow, outbox dispatch, and write adapter gates remain open.
