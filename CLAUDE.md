# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Internal, single-business web app for managing multiple Shopee shops from one dashboard, integrating only through the official Shopee Open Platform OAuth. Modular monolith in TypeScript, run directly on Node.js 24 (no build/bundle step). See `README.md` for scope and the `docs/` tree for requirements, ADRs, security, and operations.

## Commands

```bash
pnpm install                 # Node >= 24, pnpm (packageManager pinned in package.json)
pnpm run typecheck           # tsc --noEmit — this is also `pnpm run build` (there is NO emit/bundle)
pnpm run lint                # biome check .
pnpm test                    # node:test runner
pnpm run web:dev             # web server, watch mode (reads .env)
pnpm run worker:dev          # worker server, watch mode
pnpm run worker:once         # run ONE OAuth exchange batch and exit (this is what production schedules)
pnpm run worker:encryption-preflight   # validate credential-encryption env before deploy
```

Run a single / non-default test file directly (the `pnpm test` script only wires three files — `apps/web/src/app.test.ts`, `apps/worker/src/app.test.ts`, `packages/config/src/runtime-config.test.ts` — so other `*.test.ts` files, e.g. `production-app.test.ts` and `internal-session.test.ts`, must be named explicitly):

```bash
node --experimental-strip-types --test apps/web/src/production-app.test.ts
```

## Runtime and module conventions

- **No build artifacts.** Source runs as-is via `node --experimental-strip-types`; TypeScript is type-checked (`tsc --noEmit`) but never compiled. `"build"` == typecheck.
- **ESM with relative `.ts` imports.** Cross-package imports use relative file paths (`../../../packages/oauth/src/index.ts`), not package names. `tsconfig` is strict with `verbatimModuleSyntax`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `allowImportingTsExtensions`.
- **Zod at every boundary** with `.strict()` schemas. Configuration/parse failures throw typed error classes that carry `fieldNames` only — never the offending values — so secrets never reach logs or responses.

## Architecture (the parts that span files)

**Modular monolith.** `apps/web` and `apps/worker` are thin process entrypoints that compose bounded-context packages under `packages/*` (identity, oauth, integrations, persistence, catalog, analytics, staging, copy-preview, write-recovery, delivery, observability, runtime-boundaries, config, domain).

**Runtime role capability system is the central safety invariant.** `packages/runtime-boundaries` defines four roles — `web`, `worker`, `migration`, `readonly-support` — each mapped to a fixed capability set (e.g. only `worker` may hold `secret_provider`, `kms_decrypt_credentials`, `shopee_call`). Two layers enforce it:
- Runtime: `requireRuntimeCapability({ role, capability, policyVersion })` throws when a role lacks a capability.
- Static: `packages/runtime-boundaries/src/package-boundaries.test.ts` fails the build if forbidden imports appear — e.g. `apps/web` importing `worker-exchange.ts`, or anything outside `apps/worker` importing the Shopee secret provider. **Do not run Shopee token calls or credential decryption from the web process; it will break these tests and the security model.**

**Web is fail-closed.** `apps/web/src/app.ts#createWebApp` only mounts a route when its dependency is injected. `apps/web/src/main.ts` starts a bare app unless `SHOPEE_LIVE_OAUTH_ENABLED=true`, in which case it builds the production app (`production-app.ts`) with an internal operator session and live OAuth. `/api/auth/shopee/start` is gated by an HMAC-signed session cookie issued by `internal-session.ts` after the operator submits `INTERNAL_LOGIN_TOKEN`.

**OAuth connect flow spans web and worker (this is why the worker must run):**
`/connect/shopee` (UI) → `POST /api/session/login` → `GET /api/auth/shopee/start` (issues signed `state`, redirects to Shopee) → Shopee approval → `GET /api/auth/shopee/callback`. The callback (web) seals the authorization `code` and writes an `oauth_exchange_commands` row with status `pending` — the response reports `worker_exchange_pending`. The web process never calls Shopee's token API. The **worker** (`worker:once` → `packages/oauth` exchange runner) picks up pending rows, exchanges the code for tokens, stores the credential encrypted, and finalizes the connection.

**Credential encryption (`packages/oauth/src/credential-encryption.ts` + `apps/worker/.../environment-aes-gcm-envelope-backend.ts`).** AES-256-GCM envelope; ciphertext is `base64url(nonce[12] | authTag[16] | ciphertext)`; key = `WORKER_CREDENTIAL_ENCRYPTION_KEY` (32-byte base64url). The GCM AAD is the JSON-serialized KMS encryption context (`purpose`, `organizationId`, `partnerApplicationId`, `credentialSubjectId` for refresh tokens, `market`). **Only the refresh token is persisted** (`credential_subjects`); access tokens are obtained on demand by refreshing. Changing any AAD/context field makes existing ciphertext undecryptable.

**Persistence.** Raw parameterized SQL lives in `packages/*/postgres-*.ts` behind a minimal `PostgresExecutor` (`query` + `transaction`). Schema is in `db/migrations/NNNN_*.sql` (ordered, applied via `scripts/invoke-production-migrations.ps1`). `pg` connections must use `127.0.0.1` semantics per the deploy target; production uses a Neon connection string.

**Config.** `packages/config/src/runtime-config.ts` parses env per role. Worker-only Shopee secrets must never appear in web config (enforced by test).

## Deployment reality (non-obvious, but you will need it)

- **Deploys are archive-based, not git.** A zip of the source is uploaded to Hostinger and built there; web runs `web:start`. The Shopee project itself is currently **untracked by git** (the enclosing git repo root is a parent directory that tracks unrelated files).
- **The worker is not a long-running app.** `apps/worker/src/main.ts` (`worker:start`) is only a health server. Actual processing is `worker:once` (exchange) invoked on a schedule; a separate scheduled job refreshes credentials. On Hostinger these run as **cron jobs** that call the alt-nodejs 24 binary with `--env-file=<server-side worker.env>` (the app's injected env vars are not visible to cron). Production secrets are also set as Hostinger Node.js environment variables for the web process.
