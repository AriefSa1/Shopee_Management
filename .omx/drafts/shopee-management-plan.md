# Draft Implementation Plan: Internal Shopee Multi-Store Product Management

## 1. Document Status and Planning Boundary

- Status: initial Planner draft for deliberate RALPLAN-DR review.
- Product shape: greenfield, single-organization internal web application.
- Planning only: this document does not authorize source implementation, use of real credentials, production deployment, destructive data operations, or scope expansion.
- Evidence basis:
  - `.omx/specs/deep-interview-shopee-multi-store-management.md`
  - `.omx/research/shopee-open-platform-official-evidence.md`
  - `.omx/context/shopee-multi-store-management-20260908T172043Z.md`
  - `.omx/interviews/shopee-multi-store-management-20260908T172043Z.md`
- External verification boundary: exact endpoint permissions, signatures, request/response fields, quotas, regional rules, listing-status behavior, and rate limits must be reconfirmed in the business's Shopee Open Platform Console and current official guides before implementation of each integration slice.
- Stop condition for implementation: the MVP is complete only when its protected workflows pass the test plan, a credential-safe pilot environment is approved, and the 30-day pilot can measure comparable workflow time against a recorded baseline.

## 2. Outcome, Requirements, and Scope

### 2.1 Product outcome

Provide one responsive internal dashboard through which one business can manage product operations across all of its authorized Shopee shops. After a 30-day pilot, the same cross-shop product-management workflow, performed for a comparable shop count, must require at least 50% less elapsed operator time than the recorded baseline.

### 2.2 MVP capabilities

1. **Centralized catalog**
   - Authorize and retain multiple shops through the official Shopee Open Platform seller flow.
   - Synchronize and display product base information and variants for each owning shop.
   - Search and filter by shop, item status, category, SKU, stock state, and synchronization state.
   - Show last successful sync, freshness, and actionable per-shop/per-item errors.

2. **Product performance analytics**
   - Expose only metrics available to the authorized app through approved endpoints.
   - Initially model the documented product extra-information metrics: views for the last 30 days, cumulative sales, likes, ratings, and star rating.
   - Label metric definition, source, retrieval time, and whether a value is a current upstream snapshot or an app-collected historical observation.
   - Compare products and shops only over periods supported by upstream definitions or by snapshots the application has actually collected.

3. **Copy product to multiple destination shops**
   - Select one source product and one or more destination shops.
   - Retrieve destination-specific leaf categories, required attributes, brand choices, item limits, logistics channels, shipping constraints, and other currently required fields.
   - Upload media to Shopee MediaSpace where required, map the source into a destination-valid payload, and show an editable preview for every destination.
   - Require an explicit bulk confirmation bound to the validated previews before any upstream creation call.
   - Run each destination as an isolated, idempotent job. Valid destinations may succeed while invalid or failed destinations remain unpublished/retryable with field-level reasons.

### 2.3 Users and tenancy

- One explicitly modeled organization owns all users, shop connections, catalog rows, jobs, and audit events.
- Multiple internal users have Owner, Admin, or Staff memberships.
- There is no public signup, subscription billing, tenant provisioning, or cross-company administration in the MVP.
- `organization_id` remains mandatory in storage keys, queries, authorization checks, queues, logs, and audit data even though only one organization is initially deployed.

### 2.4 Non-goals

Orders/fulfillment, customer chat, ads/campaigns/vouchers/promotions, accounting or payment reconciliation, warehouses and other marketplaces, automatic real-time inventory synchronization, general-purpose bulk editing, AI-generated content, autonomous listing changes, native mobile apps, public SaaS onboarding, billing, and multi-company tenancy are outside the MVP. Copying creates a new listing; it does not establish future inventory or field synchronization.

### 2.5 Hard constraints

- Official Shopee Open Platform authorization only; no Seller Centre cookie, browser automation, or undocumented fallback.
- Partner keys, access/refresh tokens, OAuth state secrets, authorization headers, and raw credentials remain server-only and are excluded from client payloads, browser storage, errors, traces, analytics, and logs.
- Every protected operation verifies both membership permission and organization ownership of every referenced shop/resource on the server.
- Tokens are stored per shop and refreshed with rotation-safe locking.
- No Shopee write occurs before destination validation, preview, and explicit confirmation.
- External endpoint capability is dynamic evidence, not a hard-coded product promise.

## 3. RALPLAN-DR Deliberation

### 3.1 Principles

1. **Official and least-privilege integration:** use only documented Open Platform flows and expose the smallest necessary internal authority.
2. **Server-enforced isolation:** organization, shop ownership, RBAC, and secret boundaries are invariants at every entry point and asynchronous continuation.
3. **Safe, reviewable writes:** every destination is validated and previewed before a human-confirmed, idempotent upstream action.
4. **Truthful data semantics:** distinguish upstream snapshots, app-collected history, stale data, and unsupported metrics without inference or fabrication.
5. **Failure containment and auditability:** one shop's failure must not block other shops; every state transition must be explainable without logging secrets.

### 3.2 Top decision drivers

1. Correctness and safety of multi-shop OAuth, rotating tokens, ownership checks, and Shopee writes.
2. Delivery speed and operational simplicity appropriate to a greenfield internal MVP.
3. Independent background processing, retries, observability, and partial success under external rate limits and regional validation differences.

### 3.3 Viable architecture options

#### Option A — TypeScript modular monolith with separate web and worker processes (chosen)

One repository contains a Next.js web/BFF application, reusable domain/integration packages, a PostgreSQL database, and one or more background worker processes consuming a durable queue.

Pros:

- One language and shared schemas across UI, server handlers, domain logic, and worker jobs.
- Clear transactional boundaries without distributed-service overhead.
- Web requests stay responsive while sync, media, validation refresh, token refresh, and publication run asynchronously.
- Modules can later be extracted if measured load or team ownership requires it.

Cons:

- Discipline is required to prevent route handlers, domain logic, persistence, and Shopee adapters from collapsing into one layer.
- Web and worker deployments share a repository and database migration cadence.
- A Redis-compatible queue adds an operational component; a database-backed queue is a simpler but lower-throughput alternative for the pilot.

#### Option B — Service-oriented backend with separate catalog, authorization, analytics, and copy services

A frontend/BFF calls multiple independently deployed services, each with a focused datastore or schema and message bus integration.

Pros:

- Strong independent scaling and deployment boundaries.
- Clear service ownership if multiple engineering teams emerge.
- Shopee write workloads can be isolated aggressively from read traffic.

Cons:

- Premature distributed transactions, event contracts, deployment coordination, and observability overhead for one internal organization.
- Slower initial delivery and more failure modes before product-market validation.
- Harder end-to-end authorization and audit correlation without mature platform infrastructure.

#### Option C — Synchronous full-stack application with cron-only synchronization

One web process performs most Shopee calls inline and periodic synchronization through scheduled endpoints.

Pros:

- Smallest initial infrastructure footprint.
- Fastest proof of a read-only catalog.

Cons:

- Poor fit for multi-destination copy, per-shop retry isolation, token-refresh contention, rate-limit backoff, and long-running media operations.
- User requests risk timeout and ambiguous partial completion.
- Cron-only work distribution is harder to make idempotent and observable.

### 3.4 Decision

Choose **Option A**, a modular monolith with independently scalable web and worker processes. It preserves MVP delivery speed while giving copy and synchronization durable job semantics. Keep module boundaries explicit and use a transactional outbox/queue adapter so switching queue infrastructure or extracting a service does not change domain state machines.

## 4. Recommended Stack and Repository Shape

Versions are deliberately not pinned in this plan. At project bootstrap, select currently supported stable/LTS releases, capture exact versions in the lockfile, and verify compatibility and security advisories.

### 4.1 Stack

- Language/runtime: TypeScript on the current supported Node.js LTS.
- Web: Next.js App Router with server components for read-heavy screens and route handlers/server actions only at explicit application boundaries.
- UI: React, accessible component primitives, a small token-based design system, and a typed form/validation layer.
- Authentication: Auth.js-compatible OIDC integration against the business's existing identity provider; production accounts are allowlisted/invited and mapped to memberships. Development-only authentication must never be enabled in production.
- Database: PostgreSQL with migrations and a typed query/ORM layer. Prefer explicit SQL constraints and transactions for invariants rather than application checks alone.
- Validation/contracts: Zod or equivalent shared runtime schemas at environment, HTTP, queue, and Shopee adapter boundaries.
- Background jobs: a durable queue with Redis-compatible storage and a BullMQ-style worker adapter; retain an interface that allows a PostgreSQL-backed queue if pilot infrastructure constraints favor fewer services.
- Observability: OpenTelemetry-compatible traces/metrics, structured JSON logging with default-deny redaction, error reporting, health/readiness endpoints, and database-backed immutable audit records.
- Tests: unit test runner, PostgreSQL integration tests through disposable containers or an isolated test database, HTTP contract tests, and Playwright-style browser E2E tests.
- Deployment: containerized web and worker services, managed PostgreSQL, managed Redis-compatible queue, encrypted secret manager, TLS, separate staging and production environments.

### 4.2 Planned top-level file layout

```text
apps/
  web/
    app/(authenticated)/catalog/
    app/(authenticated)/analytics/
    app/(authenticated)/copy/
    app/(authenticated)/settings/shops/
    app/api/auth/shopee/start/route.ts
    app/api/auth/shopee/callback/route.ts
    app/api/internal/health/route.ts
    middleware.ts
  worker/
    src/index.ts
    src/jobs/catalog-sync.job.ts
    src/jobs/metric-snapshot.job.ts
    src/jobs/copy-destination.job.ts
    src/jobs/token-refresh.job.ts
packages/
  auth/src/
  config/src/
  db/src/schema/
  db/src/migrations/
  domain/src/catalog/
  domain/src/analytics/
  domain/src/copy/
  domain/src/rbac/
  shopee/src/client/
  shopee/src/oauth/
  shopee/src/products/
  shopee/src/media/
  queue/src/
  observability/src/
tests/
  integration/
  contract/shopee/
  e2e/
docs/
  requirements/
  architecture/
  operations/
  security/
```

## 5. Architecture and Boundaries

### 5.1 Request path

1. Browser authenticates through the configured internal OIDC provider.
2. Web server resolves `user_id`, `organization_id`, membership role, and allowed action.
3. Application service loads only organization-scoped resources and verifies shop ownership before domain logic.
4. Reads query local synchronized data; user-facing requests do not depend on a live Shopee response except explicit authorization or validation-refresh actions.
5. Mutations commit domain state and an outbox record in one database transaction.
6. A dispatcher enqueues the outbox event; workers repeat organization/RBAC-derived authorization context checks appropriate to the immutable confirmed command, acquire resource locks, call Shopee, and persist results/audit events.

### 5.2 Module boundaries

- `auth`: identity, membership, sessions, CSRF, OAuth attempt ownership.
- `rbac`: action policy and reusable server-side authorization guards.
- `catalog`: shop-owned items, variants, synchronization, filters, freshness.
- `analytics`: metric definitions, snapshots, aggregation eligibility, freshness labels.
- `copy`: source snapshots, destination requirements, mappings, validation, previews, confirmation, per-destination state machine.
- `shopee`: signatures, canonical requests, endpoint-specific adapters, token lifecycle, normalized errors, rate-limit metadata; never exposes tokens to other packages.
- `queue`: outbox dispatch, idempotent job envelopes, retries, dead-letter handling.
- `observability`: redaction, correlation IDs, metrics, traces, audit-event interface.

No UI component imports the Shopee client or database layer directly. No worker trusts client-supplied organization, role, shop ownership, preview validity, or payload hashes.

## 6. Data Model

All mutable business tables include timestamps; organization-owned tables include `organization_id`; externally synchronized rows retain an upstream update marker when Shopee provides one.

| Entity | Essential fields and invariants |
| --- | --- |
| `organizations` | `id`, `name`, pilot settings; one seeded organization in MVP. |
| `users` | `id`, identity-provider subject, email, status; unique provider subject. |
| `memberships` | `organization_id`, `user_id`, `role`, status; unique pair; role enum Owner/Admin/Staff. |
| `shop_connections` | `id`, `organization_id`, `external_shop_id`, region/market, display metadata, authorization expiry/status, last sync fields; unique `(organization_id, external_shop_id)`. |
| `shop_tokens` | `shop_connection_id`, encrypted access/refresh token ciphertext, expiries, key version, token revision, last refresh metadata; one active row per shop or append-only revisions with one active constraint. No token in ordinary query DTOs. |
| `oauth_attempts` | `id`, organization, initiating user, hashed state/verifier, redirect binding, expiry, consumed timestamp; single-use and short-lived. |
| `products` | organization/shop IDs, external item ID, SKU, name, status, category, stock summary, base JSON normalized/allowlisted fields, upstream timestamps, sync state; unique shop/item. |
| `product_variants` | product/shop ownership, external model ID, SKU, variation fields, price/stock display fields; unique product/model. |
| `metric_definitions` | stable internal key, upstream meaning, unit, aggregation rule, support status, documentation reference. |
| `product_metric_snapshots` | product/shop IDs, definition key, value, observed time, upstream window metadata; uniqueness prevents duplicate observations. |
| `sync_runs` | organization/shop, type, cursor/window, status, counts, started/completed times, correlation ID. |
| `sync_errors` | sync run, optional product, normalized code, safe message, retryability, field path, first/last occurrence. |
| `copy_batches` | organization, source shop/product, source snapshot ID/hash, creator, status, confirmation actor/time/hash. |
| `copy_destination_jobs` | batch, destination shop, state, idempotency key, attempt count, requirement snapshot hash, preview hash, safe error, upstream item ID; unique `(batch_id, destination_shop_id)`. |
| `copy_source_snapshots` | immutable allowlisted source data and media references captured at batch creation, with content hash. |
| `destination_requirement_snapshots` | destination shop/category requirements, source/reference timestamps, normalized required fields, hash, expiry. |
| `copy_previews` | destination job, mapping version, editable normalized fields, validation result, field errors, preview hash, validated timestamp; immutable revisions with one current revision. |
| `published_item_mappings` | destination job, destination shop, upstream item ID, creation outcome, variation status; unique destination job and unique destination shop/upstream item pair. |
| `outbox_events` | aggregate/type/payload reference, organization, created/published times, deduplication key. Payload contains identifiers, not secrets. |
| `audit_events` | organization, actor/service, action, resource type/id, shop, result, correlation ID, safe metadata, timestamp; append-only at application permissions. |
| `pilot_workflow_measurements` | workflow definition/version, shop count, item count, baseline/pilot duration, user, timestamp, notes; comparable cohort rules encoded. |

Database protections include composite foreign keys or equivalent repository guards that prevent an organization-owned child from referencing another organization's parent, unique idempotency constraints, optimistic revision columns where concurrent edits matter, and indexes supporting catalog filters and pending job scans.

## 7. RBAC and Authorization

| Action | Owner | Admin | Staff |
| --- | --- | --- | --- |
| View catalog, analytics, sync state, safe audit summaries | Yes | Yes | Yes |
| Create/edit copy batch and destination previews | Yes | Yes | Yes |
| Confirm and publish a validated copy batch | Yes | Yes | No |
| Trigger manual catalog/metric refresh | Yes | Yes | Limited to approved shops or No by MVP policy |
| Authorize, reauthorize, or disconnect shops | Yes | No | No |
| Invite/deactivate users or change roles | Yes | No | No |
| Change organization/security/pilot settings | Yes | No | No |
| View full audit log/export | Yes | Read-only | No |

Authorization rules:

- Centralize action names and policy in `packages/domain/src/rbac/policy.ts` and server guards in `packages/auth/src/authorize.ts`.
- Every route, server action, queue command creation, and worker resource load checks `organization_id` and resource/shop ownership.
- Confirmed commands retain `confirmed_by`, `confirmation_hash`, membership role-at-confirmation, and target IDs, but workers re-resolve organization/resource validity and reject disconnected or transferred shops.
- UI hiding is convenience only; server denial is authoritative and audited.
- Owner cannot remove/demote the last active Owner without an explicitly designed safe transfer flow, which can remain out of MVP if not needed.

## 8. Shopee OAuth, Secrets, and Token Rotation

### 8.1 Authorization flow

1. Owner requests authorization. Server creates a short-lived `oauth_attempt` bound to organization, initiating user, expected redirect, and a high-entropy state whose stored representation is hashed or authenticated.
2. Server constructs the documented Shopee authorization URL (`/auth`, seller auth, partner identifier, exact registered redirect URI, response code, state) and returns only the URL/redirect response; the partner key never leaves the server.
3. Callback validates state integrity, expiry, single-use status, initiating organization, and exact redirect context before token exchange.
4. Callback handles either `shop_id` or `main_account_id`. When exchange returns `shop_id_list`, create/update one `shop_connection` and per-shop token record for each authorized shop in a transaction-safe reconciliation flow. Never select a global "first token-bearing shop."
5. Enqueue bootstrap sync independently for every newly connected shop and emit secret-free authorization audit events.

### 8.2 Token storage and encryption

- Store tokens only as envelope-encrypted ciphertext using a managed KMS/secret-manager master key; keep key version and encryption context bound to organization and shop connection.
- Restrict decryption to the Shopee adapter/worker runtime identity. Database readers and client DTOs cannot retrieve plaintext tokens.
- Partner ID, partner key, redirect URI, encryption key references, and OIDC secrets come from validated server environment/secret configuration. Safe diagnostics identify missing variable names, never values.
- Apply log/tracing redaction at serialization and transport boundaries for token-like keys, authorization headers, callback codes, state, cookies, signed URLs, and request bodies containing credentials.

### 8.3 Rotation-safe refresh

Access tokens are documented as short-lived and refresh tokens as rotating/longer-lived; implementation must use current Console values rather than assuming duration.

1. Before an API call, load token metadata without returning plaintext outside the adapter.
2. If refresh is needed, acquire a PostgreSQL advisory lock or row lock scoped to `shop_connection_id`.
3. Re-read token revision inside the lock. If another worker refreshed it, use the newer revision and skip refresh.
4. Call refresh once with the current refresh token.
5. In one transaction, replace access and refresh ciphertext, expiries, and increment `token_revision`; retain only safe rotation metadata. New refresh tokens supersede old ones.
6. Release the lock and retry the original operation once under bounded policy.
7. On invalid/revoked refresh, mark that shop `REAUTH_REQUIRED`, stop its write jobs, retain other shops' operation, and notify Owner without secrets.

Use bounded jittered retries only for retryable transport/rate-limit failures. Never concurrently retry refresh with a stale token. Never print upstream response bodies before secret scrubbing.

## 9. Synchronization and Analytics Design

### 9.1 Catalog synchronization

- Bootstrap each shop with item-list pagination, then fetch base information, models/variants, and approved extra information in bounded batches.
- Schedule per-shop incremental polling at a conservative interval confirmed against current quotas; allow an Owner/Admin manual refresh subject to deduplication and rate limits.
- Use `(shop_connection_id, external_item_id)` upserts and upstream update timestamps/cursors when available. If reliable incremental markers are unavailable, use paged reconciliation with tombstone/status checks and a recorded sync window.
- Separate fetch success from full shop reconciliation. Do not mark a product missing/deleted until a complete authoritative scan or explicit upstream status supports it.
- Apply per-shop concurrency limits, global partner limits, exponential backoff with jitter, `Retry-After` support, and circuit breaking for sustained upstream faults.

### 9.2 Analytics limitations

- Maintain a metric registry containing definition, unit, upstream endpoint/field, whether it is cumulative or windowed, and allowed aggregation.
- Initial supported display is limited to officially available values such as 30-day views and cumulative sales/likes/ratings/star rating, contingent on actual app permission and regional response fields.
- A 30-day views value is a rolling upstream snapshot, not a daily event series; overlapping snapshots must not be summed.
- Cumulative counters may be displayed and compared as snapshots. A delta is shown only when two valid observations exist and reset/decrease behavior is explicitly handled.
- Ratings/star rating are not additively aggregatable. Shop-level displays must use a documented/explicit aggregation rule (for example, item-count weighted only if the required counts exist) or show a distribution/list instead.
- Historical charts begin when the application starts collecting snapshots. The UI states "history available since <date>" and never implies upstream backfill.
- Impressions, clicks, conversion rate, revenue/profit, ad attribution, and other unsupported metrics are absent or explicitly marked unavailable; they are never estimated.
- Every analytics card/table includes observed-at time, source window, last successful sync, and stale/error state.

## 10. Copy Product Validation, Confirmation, and Idempotency

### 10.1 State model per destination

`DRAFT -> REQUIREMENTS_LOADING -> NEEDS_INPUT | INVALID | VALIDATED -> CONFIRMED -> QUEUED -> PUBLISHING -> SUCCEEDED`

Failure branches are `RETRYABLE_FAILED`, `TERMINAL_FAILED`, `REAUTH_REQUIRED`, `REQUIREMENTS_STALE`, and `PARTIAL_CREATED`. Only `VALIDATED` with an unchanged preview can become `CONFIRMED`. Invalid jobs never enqueue a write.

### 10.2 Preview and validation

1. Capture an immutable, allowlisted source snapshot and content hash; later source sync changes do not silently alter an existing batch.
2. For each destination, fetch/cache a destination-specific requirement snapshot: leaf categories, mandatory attributes, brands, item limits, logistics channels, shipping rules, media constraints, and any currently documented regional fields.
3. Map source fields through explicit mapping functions. Never copy destination-owned identifiers, source category IDs blindly, tokens, unsupported logistics IDs, or opaque raw payloads.
4. Upload/prepare media only according to verified API ordering. Prefer deferring upstream media writes until confirmation when possible; if pre-upload is technically required, classify it as a reversible staged artifact, disclose it in the preview, and clean it by documented policy.
5. Validate types, required fields, enumerations, lengths, category/brand/logistics compatibility, variation structure, price/stock rules, and item limits. Return field paths, safe explanations, and suggested user action.
6. Store an immutable preview revision and hash over source snapshot, destination requirements, normalized mapped payload, media references, destination shop, and mapping version.
7. Confirmation submits selected destination IDs and their preview hashes. Server rechecks role, ownership, connection state, requirement freshness, current preview hash, and validation status, then records one confirmation hash and emits one job per valid selected destination.

### 10.3 Idempotency and retry safety

- Stable job idempotency key: hash of `organization_id + copy_batch_id + destination_shop_id + operation_version`. A database unique constraint is authoritative.
- Stable payload fingerprint: source snapshot hash + requirement snapshot hash + preview hash + adapter mapping version.
- Before any add-item call, check `published_item_mappings` under transaction/lock. After upstream success, persist the returned destination item ID before starting optional variation initialization or post-create work.
- If the upstream call times out after an unknown commit result, do not blindly call add-item again. Move to `OUTCOME_UNKNOWN` (represented as a retry-blocking safe state or explicit extension), reconcile through an approved lookup/correlation strategy, and require operator resolution if the API cannot prove the outcome.
- Once a destination item ID is stored, retries resume from the next incomplete step and never repeat item creation.
- Media upload results are cached by destination shop plus source media content hash where API semantics permit reuse; invalid/expired handles are refreshed without duplicating item creation.
- The worker records attempt number, normalized Shopee request identifier when safe, result code, and state transition. Raw signed requests and credentials are never audited.

### 10.4 Listing status uncertainty gate

The supplied official evidence confirms `add_item` and later variation initialization but does not establish that every market/app can create a draft or hidden listing. Therefore:

- Local preview is always mandatory and no upstream write occurs before confirmation.
- Before implementation, verify whether the destination can be created as draft/unlisted and whether variation initialization is atomic or sequential for the current market.
- If draft creation is supported, create non-public first, initialize variations, validate the result, then publish/enable according to the documented endpoint.
- If it is not supported, communicate that confirmation creates the listing immediately; persist the item ID after `add_item`, and treat a later variation failure as `PARTIAL_CREATED`, not as an unpublished failure. Provide an explicit repair/cleanup workflow and never claim atomicity.

## 11. Security and Privacy Controls

- Threat model OAuth state replay, callback substitution, cross-organization/shop IDOR, SSRF through media URLs, stored XSS in product text, CSRF on writes, queue-message tampering, token/log leakage, dependency compromise, and privilege escalation.
- Validate outbound hosts against explicit Shopee endpoint allowlists; fetch source media through bounded, content-type/size-checked server logic or approved upstream URLs. Do not follow arbitrary redirects into private networks.
- Escape product content by default; sanitize any intentionally rendered rich content.
- Use secure, HTTP-only, same-site session cookies, CSRF protections, short session lifetime appropriate to internal use, and step-up/recent-auth consideration for shop authorization and role changes.
- Apply strict security headers and Content Security Policy. Do not place secrets in public environment variables.
- Rate-limit authorization starts/callback failures, manual sync, validation refresh, and confirmation endpoints per user/organization/shop.
- Audit all role-sensitive actions, authorization lifecycle, sync triggers/results, preview/confirmation, publication outcomes, and administrative changes with append-only application semantics.
- Define retention: keep operational/audit evidence long enough for the pilot and incident review, minimize OAuth attempt/state retention, and purge obsolete ciphertext/media references through an approved non-destructive policy.
- Run dependency, secret, static, container, and migration checks in CI; block production deployment on critical unresolved findings.

## 12. Observability and Operations

### 12.1 Correlation and logs

- Generate one correlation ID per inbound request, batch, destination job, sync run, and Shopee attempt; propagate IDs rather than secret payloads.
- Structured fields: environment, service, organization ID, safe user ID, shop connection ID, operation, job state, attempt, duration, normalized upstream code, retryability, and result.
- Redaction tests are release gates. Unknown objects use allowlist serialization; no raw headers/body dumping.

### 12.2 Metrics and alerts

- OAuth: start/callback success, invalid/expired/replayed state, token exchange latency, shops returned per authorization, reauthorization-required count.
- Tokens: refresh attempts/success/failure, lock wait, stale-revision avoidance, time to expiry, revoked connections.
- Catalog: sync duration, items fetched/upserted/failed, freshness age, pagination progress, rate-limit/backoff, reconciliation incompleteness.
- Copy: batches created/confirmed, validation error categories, destination state counts, time-to-preview, time-to-publish, retries, outcome-unknown, partial-created, duplicate-prevention conflicts.
- Queue: depth, oldest age, processing latency, retry/dead-letter count, outbox lag.
- App: protected-route denial counts, HTTP latency/error rate, database pool/lock health, worker heartbeat.
- Pilot: median and percentile workflow duration by comparable workflow version, shop count, and item count.

Initial service objectives for the pilot should be treated as tunable targets: authenticated local-data reads remain usable during Shopee outages; 95% of healthy catalog pages load within an agreed internal threshold; pending jobs are visible within one refresh cycle; no confirmed secret leakage; and no duplicate destination listing attributable to a retry. Exact latency targets are set after staging baseline measurements.

### 12.3 Operational documentation

Runbooks cover reauthorization, failed refresh, rate limiting, stuck/poison jobs, outcome-unknown reconciliation, partial-created repair, data resync, migration rollback/roll-forward, secret rotation, and incident log/audit export.

## 13. Implementation Phases

### Phase 0 — Evidence gates and requirement baseline

Future artifacts:

- `docs/requirements/PRD.md`
- `docs/requirements/acceptance-criteria.md`
- `docs/requirements/shopee-capability-matrix.md`
- `docs/architecture/ADR-001-modular-monolith.md`
- `docs/security/threat-model.md`
- `docs/operations/pilot-measurement.md`

Work:

- Convert the interview specification into a traceable PRD and acceptance matrix.
- With no credential values recorded in docs, verify current app permissions, markets, callback host, token semantics, endpoint fields, media flow, product creation status, variation ordering, rate limits, and error behavior in the Open Platform Console/current official guides.
- Record unsupported/uncertain capability as a release gate rather than inventing behavior.
- Define the comparable baseline workflow and measurement instrument before users adopt the MVP.

Exit criteria: every MVP requirement maps to an owner module and acceptance test; Shopee capability matrix has confirmed/unsupported/unknown status with evidence date; unresolved unknowns block only the affected slice.

### Phase 1 — Foundation, identity, tenancy, and security

Future implementation paths:

- `package.json`, `pnpm-workspace.yaml`, `turbo.json` or equivalent workspace config
- `apps/web/app/`, `apps/web/middleware.ts`
- `packages/config/src/env.ts`
- `packages/db/src/schema/{organizations,users,memberships,audit}.ts`
- `packages/auth/src/{session,authorize}.ts`
- `packages/domain/src/rbac/policy.ts`
- `packages/observability/src/{logger,redaction,tracing,metrics}.ts`

Work:

- Bootstrap workspace, CI, migrations, environment validation, local/staging configuration, OIDC auth, seeded organization, invitation/allowlist behavior, RBAC guards, audit interface, and secret-safe telemetry.
- Implement health/readiness checks and transaction/outbox primitives.

Exit criteria: role and ownership tests pass; production fails closed on missing secure auth/secret configuration; redaction suite proves representative secret forms never leave the server.

### Phase 2 — Official multi-shop authorization and token lifecycle

Future implementation paths:

- `apps/web/app/api/auth/shopee/{start,callback}/route.ts`
- `apps/web/app/(authenticated)/settings/shops/page.tsx`
- `packages/db/src/schema/{shop-connections,shop-tokens,oauth-attempts}.ts`
- `packages/shopee/src/{client,signature,error}.ts`
- `packages/shopee/src/oauth/{authorization,exchange,refresh}.ts`
- `apps/worker/src/jobs/token-refresh.job.ts`

Work:

- Implement state-bound seller authorization, callback reconciliation for `shop_id` and `main_account_id`/`shop_id_list`, per-shop encrypted token storage, rotation-safe refresh locking, reauthorization state, disconnect behavior, and authorization audit events.

Exit criteria: multiple returned shops persist distinctly; concurrent refresh cannot overwrite a newer refresh token; cross-organization/shop access is denied; no secret appears in snapshots, logs, errors, traces, or client traffic.

### Phase 3 — Catalog synchronization and combined catalog UI

Future implementation paths:

- `packages/db/src/schema/{products,product-variants,sync-runs,sync-errors,outbox-events}.ts`
- `packages/domain/src/catalog/{service,filters,freshness}.ts`
- `packages/shopee/src/products/{list,base-info,models,extra-info}.ts`
- `packages/queue/src/{producer,consumer,retry}.ts`
- `apps/worker/src/jobs/catalog-sync.job.ts`
- `apps/web/app/(authenticated)/catalog/{page,loading,error}.tsx`
- `apps/web/app/(authenticated)/catalog/[productId]/page.tsx`

Work:

- Implement per-shop paged sync, safe reconciliation, variants, filters/search, freshness and errors, queue limits/backoff, and responsive combined catalog/detail views.

Exit criteria: all six required filters work over organization-scoped data; detail/variant ownership is correct; one shop failure does not block others; stale/error states are visible and actionable.

### Phase 4 — Metric snapshots and truthful analytics

Future implementation paths:

- `packages/db/src/schema/{metric-definitions,product-metric-snapshots}.ts`
- `packages/domain/src/analytics/{definitions,aggregation,freshness}.ts`
- `apps/worker/src/jobs/metric-snapshot.job.ts`
- `apps/web/app/(authenticated)/analytics/{page,loading,error}.tsx`

Work:

- Persist permitted extra-info snapshots, define safe aggregation/comparison behavior, show source windows/freshness/history start, and suppress unsupported metrics.

Exit criteria: metric semantics are visible; rolling values are not summed; comparisons use only supported periods/collected snapshots; unavailable data remains unavailable rather than zero or fabricated.

### Phase 5 — Copy planning, destination validation, and preview

Future implementation paths:

- `packages/db/src/schema/{copy-batches,copy-jobs,copy-snapshots,copy-previews}.ts`
- `packages/domain/src/copy/{state-machine,mapper,validator,preview-hash}.ts`
- `packages/shopee/src/products/{categories,attributes,brands,limits,logistics}.ts`
- `packages/shopee/src/media/upload.ts`
- `apps/web/app/(authenticated)/copy/{new,preview}/page.tsx`

Work:

- Build immutable source snapshots, destination requirement snapshots, explicit mapping, editable per-shop forms, field-level validation, preview hashes, requirement freshness, and ten-destination pressure scenario UI.

Exit criteria: ten destinations yield ten independent previews; invalid destinations cannot be selected for confirmation; editing regenerates validation/hash; no Shopee product write occurs.

### Phase 6 — Confirmed idempotent publication and recovery

Future implementation paths:

- `packages/db/src/schema/{published-item-mappings,idempotency-keys}.ts` (or constraints colocated with copy jobs)
- `packages/domain/src/copy/{confirmation,publisher,recovery}.ts`
- `packages/shopee/src/products/{add-item,init-variation}.ts`
- `apps/worker/src/jobs/copy-destination.job.ts`
- `apps/web/app/(authenticated)/copy/[batchId]/page.tsx`

Work:

- Bind confirmation to hashes/actor/role, enqueue valid destinations, publish independently, persist upstream identifiers immediately, resume multi-step publication, normalize field errors, handle rate limits/reauth, and introduce explicit `OUTCOME_UNKNOWN`/`PARTIAL_CREATED` operator paths.

Exit criteria: seven valid and three invalid destinations behave exactly as the pressure scenario; retry cannot duplicate seven successes; failed destinations do not block successes; unreviewed/changed previews never publish.

### Phase 7 — Hardening, operational readiness, and 30-day pilot

Future implementation paths:

- `tests/{integration,contract,e2e}/`
- `docs/operations/{runbooks,rollback,pilot-measurement}.md`
- `docs/security/{threat-model,secret-handling}.md`
- deployment manifests under `infra/` after the approved hosting target is chosen

Work:

- Run full security/test gates, load/rate-limit simulations, backup/restore exercise, staged credential test with approved non-production shops, accessibility/responsive QA, operator training, baseline measurement, and controlled pilot rollout.

Exit criteria: no critical security/test gaps; runbooks exercised; rollback and token reauthorization tested; baseline cohort frozen; pilot telemetry can calculate the 50% outcome without collecting credentials or unnecessary personal data.

## 14. Testable Acceptance Criteria

1. An Owner completes one official authorization where the callback/exchange yields multiple shop IDs; each becomes a distinct organization-owned connection with independent token metadata and bootstrap sync.
2. Automated client-contract, log-capture, trace-export, error-reporting, and rendered-UI tests find none of the secret canary values placed in partner key, token, state, callback code, cookie, or authorization-header inputs.
3. Catalog test fixtures spanning multiple shops can be searched and filtered by shop, status, category, SKU, stock state, and sync state with no cross-organization result.
4. Product detail returns only the base/variant rows belonging to its shop; forged organization/shop/product identifiers receive a non-disclosing denial.
5. Analytics UI and API return metric definition, source window/type, observed time, freshness, and history start; unsupported fields are absent/Unavailable, not synthesized.
6. A source copied to ten shops produces ten independently editable validation previews. With three invalid, confirmation accepts the seven valid destinations and rejects selection of the three invalid.
7. A terminal or retryable failure in one destination does not change another destination's state, confirmation hash, or result.
8. Replaying confirmation, redelivering queue messages, restarting a worker after upstream success, and retrying a completed batch produce no second destination listing for a completed destination.
9. Staff cannot confirm/publish, authorize shops, or manage roles; Admin cannot authorize/disconnect shops or manage memberships; Owner can perform defined actions. Every denial is server-enforced and safely audited.
10. Authorization, shop changes, sync starts/results, validation, preview replacement, confirmation, publication result, retry/recovery, and role-sensitive operations produce append-only audit events with actor/service, organization, shop/resource, correlation, result, and no secrets.
11. Callback state is single-use and expiring; replay, mismatched organization/session, altered state, and wrong redirect context fail without token exchange.
12. Two simultaneous refresh attempts for one shop result in at most one upstream refresh using a given refresh-token revision; all subsequent work observes the winning rotated token.
13. During a simulated Shopee outage, local catalog/analytics remain readable with stale indicators while queued work backs off without unbounded request growth.
14. Responsive and keyboard-accessible core workflows pass on agreed desktop, tablet, and mobile browser viewports; destructive/externally visible actions have explicit confirmation and clear state feedback.
15. Before pilot start, operators record comparable baseline workflow duration and shop/item count. After 30 days, the report uses the same workflow definition/cohort rules and shows at least a 50% reduction or explicitly records that the business target was not met.

## 15. Expanded Deliberate Test Plan

### 15.1 Unit tests

- RBAC policy table for every action/role and last-Owner invariant.
- Organization/shop resource guards and composite ownership predicates.
- Environment parsing and fail-closed production configuration.
- Signature/canonical-request functions using official sanitized examples where available.
- OAuth state creation, hashing/authentication, expiry, consumption, replay, and redirect binding.
- Token refresh decision, revision comparison, encryption context, and safe error mapping.
- Secret redactor with key-name, header, nested object, query string, exception, and unexpected-value canaries.
- Catalog filter parsing, stock/sync-state derivation, and freshness calculation.
- Metric registry semantics: rolling vs cumulative vs non-additive; delta/aggregation eligibility.
- Copy mapping for category/attribute/brand/logistics/variation boundaries.
- Field-level validator paths and normalized safe messages.
- Source/requirement/preview hash stability and invalidation after an edit.
- Copy state machine: allowed/forbidden transitions, confirmation eligibility, partial/outcome-unknown branches.
- Idempotency key and payload fingerprint determinism.
- Retry classifier, jitter/backoff bounds, rate-limit handling, and dead-letter threshold.
- Audit event allowlist and absence of secret fields.

### 15.2 Integration tests

- PostgreSQL migrations forward and tested rollback/roll-forward strategy on representative data.
- Database constraints for organization ownership, unique shop IDs, unique copy destinations, one active token revision, and published-item uniqueness.
- OAuth callback transaction with `shop_id`, `main_account_id`, multi-entry `shop_id_list`, duplicate callback, partial database failure, and retry.
- Concurrent token refresh workers proving one winning rotation and no stale overwrite.
- Outbox atomicity: domain commit plus event, dispatcher retry, duplicate delivery, and crash between enqueue/ack.
- Mock Shopee contract server for pagination, rate limits, 401/reauth, schema drift, regional missing fields, timeouts before/after commit, and sanitized upstream errors.
- Catalog reconciliation with interrupted pages, duplicate items, changed variants, inactive items, and incomplete scans.
- Snapshot collection and no-invalid aggregation behavior.
- Per-destination requirement cache freshness and invalidation.
- Media upload reuse/expiry behavior under the confirmed official contract.
- Publication persistence after add-item before variation initialization; retry resumes without second add-item.
- Audit/log/trace sink scanning with secret canaries through success and failure paths.

### 15.3 End-to-end tests

- Owner login, official OAuth flow against a controlled stub/sandbox, multiple shops displayed, bootstrap sync states visible.
- Staff/Admin/Owner navigation and forged network requests for every protected mutation.
- Combined catalog filters, pagination, stale/error displays, and variant detail across shops.
- Analytics comparison with mixed freshness, missing metrics, history start, and non-additive metrics.
- Copy one item to ten shops: seven valid, three invalid; edit one invalid preview; confirm only valid; observe independent progress/results.
- Double-click confirmation, browser retry, repeated HTTP request, duplicate queue delivery, worker restart, and manual retry without duplicates.
- Requirement changes between preview and confirmation force revalidation and prevent stale publication.
- Token expiry during a copy batch refreshes safely; revoked shop becomes `REAUTH_REQUIRED` while other destinations complete.
- Timeout with unknown upstream outcome blocks blind retry and displays operator recovery guidance.
- Partial item/variation creation displays the stored destination item ID and repair path.
- Keyboard navigation, focus/error association, screen-reader labels, and responsive viewport checks for catalog, preview, confirmation, and result screens.
- Shopee outage/read-only degradation and recovery.
- Pilot timer/measurement capture and comparable report generation.

### 15.4 Observability tests

- Inject known canary secrets into every credential-bearing boundary and assert absence from browser payloads, structured logs, traces, metrics labels, audit metadata, queue payloads, and error-reporting events.
- Assert one correlation chain from UI confirmation through batch, destination queue job, Shopee attempt, database result, and audit event.
- Trigger invalid state replay, repeated refresh failure, stale catalog, rate-limit storm, dead-letter job, outcome unknown, partial creation, and queue backlog; confirm the intended metric and alert fires once with actionable safe context.
- Verify health vs readiness: web can be healthy while Shopee is unavailable; readiness reflects required database/queue dependencies; worker heartbeat detects stalled consumers.
- Load-test representative shop/item counts and ten-destination publication under configured concurrency; verify rate limiting, bounded queue growth, database lock behavior, and no secret/high-cardinality metric leakage.
- Exercise dashboards/runbooks during a staging incident simulation and record time to identify affected organization/shop/job without raw credentials.

## 16. Rollout Strategy

1. **Local/CI:** stub Shopee contracts, disposable database/queue, secret canaries, deterministic time, no real credentials.
2. **Staging evidence gate:** only after user approval for credential use, connect controlled non-production/test shops where Shopee permits; verify callback host, permission set, quotas, regional schemas, token rotation, item status, media, and cleanup behavior.
3. **Read-only internal alpha:** Owner plus one operator, authorization/catalog/analytics only; compare sync results manually with Seller Centre and tune freshness/rate limits.
4. **Write-enabled pilot:** enable copy behind a server-side feature flag for Owner/Admin, begin with one source/one destination, then expand destination count after duplicate/partial recovery drills pass.
5. **30-day pilot:** freeze baseline definition, train users, monitor job/secret/security dashboards, review failures weekly, and compute comparable duration reduction at day 30.
6. **Go/no-go:** continue only if security invariants hold, operational load is acceptable, copy correctness is demonstrated, and the business outcome is met or an explicit product decision accepts the gap. Scope expansion remains a new decision.

Rollback is capability-scoped: disable confirmation/publication first while retaining read-only catalog and audit access; stop affected queue consumers; preserve job/audit evidence; reauthorize or reconcile ambiguous states before re-enabling. Never delete failed-job evidence as a rollback mechanism.

## 17. Pre-Mortem

### Failure scenario 1 — Token rotation causes intermittent cross-shop authorization failures

- Early signals: bursts of 401s after refresh, refresh failures clustered by shop, token revisions decreasing/overwriting, jobs succeeding only after manual reauthorization.
- Likely cause: concurrent workers reuse a rotated refresh token or select a token by global availability rather than owning shop.
- Prevention: per-shop token rows, shop-scoped locks, transactional revision replacement, ownership-bound token lookup, concurrency integration test.
- Recovery: pause the affected shop only, mark `REAUTH_REQUIRED`, preserve other shops, reauthorize through Owner, and replay safe idempotent jobs.

### Failure scenario 2 — Copy retries create duplicates or incomplete public listings

- Early signals: multiple destination item IDs per job, timeout retries around add-item, high `PARTIAL_CREATED` or outcome-unknown count, user reports of visible incomplete listings.
- Likely cause: treating a multi-step external write as atomic or retrying after an ambiguous upstream commit.
- Prevention: durable idempotency constraints, persist item ID before later steps, explicit state machine, verified draft/unlisted behavior, no blind retry after unknown outcome.
- Recovery: disable publication flag, reconcile upstream items by approved identifiers, repair or explicitly remove only with user-approved destructive workflow, then resume from stored step.

### Failure scenario 3 — Analytics earn distrust because labels imply history/metrics the API does not provide

- Early signals: totals disagree with Seller Centre, 30-day views are summed across snapshots, charts appear before sufficient history, operators export unsupported profit/conversion conclusions.
- Likely cause: treating snapshots as events, ignoring differing metric windows, or masking missing values as zero.
- Prevention: metric registry, aggregation eligibility, freshness/window labels, capability matrix, contract fixtures, analytics unit/E2E tests.
- Recovery: hide the affected metric behind a feature flag, correct definitions and historical transformations only when provable, annotate the gap, and revalidate with current official evidence.

## 18. Risks and Mitigations

| Risk | Impact | Mitigation / gate |
| --- | --- | --- |
| Open Platform permissions or regional fields differ from guides | Blocks or changes features | Capability matrix per app/market; adapter feature flags; implementation-time Console verification. |
| Older product-info documentation drifts | Incorrect requests/data semantics | Contract tests against current documented schemas; safe unknown-field handling; dated evidence record. |
| Rate limits are lower/dynamic | Slow/stalled sync and copy | Per-shop/global limiters, queue backpressure, jitter, `Retry-After`, tunable schedules, dashboards. |
| Creation cannot be draft/unlisted | Confirmed writes may be immediately visible | Local preview, explicit UX wording, verify status behavior, partial-recovery plan; do not promise atomic publication. |
| Add-item succeeds but response is lost | Duplicate risk | Outcome-unknown state, upstream reconciliation, no blind retries, unique mapping once ID is known. |
| Secret leaks through generic logging/errors | Credential compromise | Default-deny serialization, canary tests, KMS encryption, restricted runtime identity, incident rotation runbook. |
| IDOR/cross-shop access | Unauthorized data/write | Mandatory organization IDs, composite constraints, centralized server guards, adversarial tests. |
| Queue/outbox inconsistency | Lost or duplicated work | Transactional outbox, idempotent consumers, delivery/restart tests, queue metrics/dead letter. |
| Stale destination requirements | Rejected/invalid listings | Requirement timestamps/hashes/TTL; revalidate at confirmation; field-level correction. |
| MVP becomes a general operations platform | Delay and diluted outcome | Enforce non-goals; separate change-control decision for new modules. |
| Pilot success comparison is biased | Unprovable 50% outcome | Record workflow version, shop/item count, baseline before adoption, comparable cohort, percentile plus median. |
| OIDC provider/managed infrastructure adds cost | Blocked deployment decision | Use existing business IdP where available; surface any new recurring cost for user approval before purchase. |

## 19. Verification Sequence and Release Gates

1. Requirement traceability and Shopee capability matrix approved; unknown external behavior explicitly gated.
2. Static checks: formatting, lint, TypeScript typecheck, dependency/secret/static security scans.
3. Unit suite passes, including state machines, authorization, analytics semantics, hashes/idempotency, and redaction.
4. Integration suite passes against isolated PostgreSQL/queue and Shopee contract stub, including concurrency and crash recovery.
5. E2E suite passes for all roles, multi-shop catalog, analytics truthfulness, ten-shop copy pressure scenario, retries, responsive/accessibility paths.
6. Observability/incident simulations prove correlation, alerts, redaction, and runbook usability.
7. Approved staging credential verification confirms current endpoint permissions, rate limits, token rotation, media, category/attribute/logistics, listing status, and variation behavior.
8. Backup/restore, migration roll-forward/rollback, feature-flag rollback, and queue drain/replay exercises pass.
9. Read-only alpha reconciliation passes before write flag is enabled.
10. Pilot measurement instrumentation and comparable baseline are frozen before the 30-day clock starts.

No production write capability ships with an unverified creation-status assumption, failing secret-canary test, missing idempotency constraint, or unexercised ambiguous-outcome recovery path.

## 20. ADR-001: Modular Monolith with Durable Per-Shop Jobs

### Status

Proposed for Architect and Critic review; not execution authorization.

### Context

The MVP must combine multi-shop catalog reads, truthful metric snapshots, OAuth/token rotation, and multi-destination external writes. It is greenfield and internal to one organization, but external API latency, partial failure, rotating credentials, and idempotency make a purely synchronous application unsafe.

### Decision drivers

1. Multi-shop security and write correctness.
2. MVP delivery/operational simplicity.
3. Failure isolation, retries, and auditability.

### Decision

Build a TypeScript modular monolith in one workspace, deployed as separate Next.js web and background worker processes. Use PostgreSQL as the source of truth, a transactional outbox, and a durable queue for per-shop sync and per-destination copy jobs. Keep Shopee integration, domain state machines, RBAC, persistence, queue, and observability as explicit packages/modules.

### Alternatives considered

- Microservices: valid for independently owned/high-scale domains, but rejected for MVP because distributed operations and platform overhead exceed present needs.
- Synchronous web plus cron: viable for a read-only prototype, but rejected for the required long-running, partially successful, idempotent multi-shop writes.

### Why chosen

The selected structure minimizes distributed-system cost while preserving durable asynchronous boundaries where external behavior demands them. It supports a one-team MVP and provides seams for extraction only after measurements justify it.

### Consequences

- Positive: shared types, simpler transactions/migrations, lower deployment count than services, independent worker scaling, clear retry/audit flow.
- Negative: team discipline and dependency-boundary checks are required; web and worker coordinate migrations; PostgreSQL plus queue must be operated.
- Neutral: modules may be extracted later, but no extraction is planned without load/team evidence.

### Follow-ups

- Confirm the hosting platform, business OIDC provider, managed database/queue choices, and cost before purchase/deployment.
- Record the queue implementation decision and failure semantics during bootstrap.
- Create separate ADRs for identity provider, encryption/key management, and Shopee listing-status strategy once official capability evidence is verified.

## 21. Requirement-Document Inventory

### 21.1 Existing authoritative inputs

| Path | Role |
| --- | --- |
| `.omx/context/shopee-multi-store-management-20260908T172043Z.md` | Original greenfield context, known facts, constraints, and earlier unknowns. |
| `.omx/interviews/shopee-multi-store-management-20260908T172043Z.md` | Ten-round decision transcript summary and pressure-pass evidence. |
| `.omx/specs/deep-interview-shopee-multi-store-management.md` | Crystallized execution-ready scope, constraints, and acceptance criteria; primary product input. |
| `.omx/research/shopee-open-platform-official-evidence.md` | Dated official-guide evidence and external verification limitations; primary integration input. |
| `.omx/deep-interview-state-input.json` | Machine-readable interview lifecycle/score record; trace evidence, not a requirements authority over the crystallized spec. |
| `.omx/drafts/shopee-management-plan.md` | This initial Planner/RALPLAN-DR draft. |

### 21.2 Required planning artifacts before implementation

| Future path | Required contents |
| --- | --- |
| `.omx/plans/shopee-management-plan.md` | Reviewed final consensus plan, including RALPLAN-DR/ADR and execution boundaries. |
| `docs/requirements/PRD.md` | Product problem, users, journeys, MVP/non-goals, outcome, UX behavior, and trace IDs. |
| `docs/requirements/acceptance-criteria.md` | Requirement-to-test matrix covering all numbered criteria and failure scenarios. |
| `docs/requirements/shopee-capability-matrix.md` | Dated per-market/app endpoint permissions, fields, quotas, token behavior, media/listing/variation behavior, and evidence links. |
| `docs/requirements/copy-product-state-machine.md` | States, transitions, invariants, confirmation binding, idempotency, partial/unknown recovery. |
| `docs/requirements/analytics-semantics.md` | Metric definitions, windows, aggregation, history limits, freshness, unavailable behavior. |
| `docs/requirements/rbac-matrix.md` | Roles/actions, server enforcement, resource ownership, denial/audit behavior. |
| `docs/architecture/ADR-001-modular-monolith.md` | Finalized form of ADR-001. |
| `docs/architecture/data-model.md` | Entities, relations, constraints, indexes, retention, organization scoping. |
| `docs/architecture/integration-contracts.md` | Internal DTO/queue boundaries and normalized Shopee adapter/error contracts. |
| `docs/security/threat-model.md` | Assets, trust boundaries, threats, controls, abuse cases, verification. |
| `docs/security/secret-handling.md` | KMS/encryption, runtime access, rotation, redaction, incident response. |
| `docs/testing/test-strategy.md` | Unit/integration/E2E/observability matrices, fixtures, environments, release gates. |
| `docs/operations/runbooks.md` | Reauth, rate limit, queue, partial/unknown copy, resync, incident workflows. |
| `docs/operations/rollback.md` | Feature-flag rollback, queue drain/replay, migration/restore, evidence preservation. |
| `docs/operations/pilot-measurement.md` | Baseline/pilot protocol, cohort comparability, reports, 50% decision rule. |

These are the complete requirement and readiness documents presently needed for the agreed MVP. Additional documents require a concrete new risk or scope decision rather than being created by default.

## 22. Agent Staffing and Future Team + Ultragoal Handoff

### 22.1 Available agent-type roster relevant to this plan

- `explore`: repository structure and current implementation mapping.
- `researcher`: current official Shopee/framework/platform documentation.
- `dependency-expert`: compare/select identity, ORM, queue, hosting, and observability dependencies.
- `architect`: review boundaries, state machines, reliability, data/security tradeoffs.
- `critic`: adversarial plan/acceptance/risk/test completeness gate.
- `executor`: implement bounded slices.
- `test-engineer`: fixtures, concurrency, contract, E2E, and failure-injection coverage.
- `debugger`: investigate runtime/integration failures.
- `verifier`: independently validate completion claims and evidence.
- `code-reviewer`: quality/security review after implementation.
- `designer`: catalog/analytics/copy UX, responsive/accessibility states.
- `writer`: finalize requirements, ADRs, runbooks, and operator guidance.
- `git-master`: atomic commit/branch strategy when an execution lane is authorized.
- `code-simplifier`: post-feature simplification without behavior change.

### 22.2 Recommended staffing by lane

Use `$ultragoal` as the default durable execution ledger only after final consensus and an official host-issued execution receipt are verified. Combine it with `$team` because the implementation contains parallelizable lanes but has strict sequential gates.

Suggested team shape (maximum six concurrent children under the workspace contract):

1. **Leader/architect lane — high or xhigh reasoning:** owns goal ledger, integration order, module boundaries, migrations, cross-lane decisions, and final stop/go.
2. **Shopee/security executor — high reasoning:** OAuth, signatures, token encryption/rotation, adapter error/rate limits, capability evidence.
3. **Domain/data executor — medium/high reasoning:** schema, outbox/queue, catalog sync, analytics semantics, copy state/idempotency.
4. **Web/designer executor — medium/high reasoning:** authenticated UI, catalog/analytics/copy flows, responsive/accessibility states; does not bypass server guards.
5. **Test engineer — high reasoning:** contract stubs, concurrency/crash tests, ten-shop scenario, E2E/failure injection, observability canaries.
6. **Verifier/code-review lane — high reasoning:** independent RBAC/secret/idempotency review, evidence ledger, regression and release gate validation.

Do not parallelize dependent integration gates: foundation precedes OAuth; OAuth precedes real catalog sync; destination requirement evidence precedes copy mapping; preview/hash semantics precede publication; Architect completes before Critic; implementation verification completes before production authorization.

### 22.3 Launch guidance after authorization

- Durable default: invoke `$ultragoal` with the final `.omx/plans/shopee-management-plan.md`, splitting goals by Phases 0–7 and requiring evidence for every exit criterion.
- Parallel implementation: invoke `$team` from the Ultragoal-led branch after Phase 0 acceptance, with explicit file/package ownership and no overlapping schema migration authors. A representative CLI hint is `omx team 5:executor "Execute the approved Shopee management plan by assigned lanes; preserve scope and return test evidence"`; adapt worker count/roles to the installed runtime rather than assuming it is available.
- Checkpoints: leader integrates schema/contracts first; each lane returns changed paths, tests, risks, and secret-safe evidence; verifier reruns the complete phase gate before the Ultragoal goal is marked complete.
- Team verification: test engineer owns scenario execution, verifier independently checks artifacts/output, leader owns cross-module test/build/security gates and the final pilot readiness claim.
- `$ralph` is an explicit fallback only for a narrowly scoped persistent single-owner slice when Team coordination is unavailable or counterproductive. It does not supersede Ultragoal's durable goal tracking.
- `$autoresearch-goal` is reserved for a separate research-heavy unresolved capability question; `$performance-goal` is reserved for a measured optimization effort after baseline data exists.

### 22.4 Handoff safety

This draft is Planner evidence only. Architect review must precede Critic review. Even local approval does not authorize execution: until the documented host consensus receipt is available and verified, record the consensus gate as incomplete with blocker `documented_host_consensus_receipt_unavailable`. Real credentials, external costs, and production deployment remain explicit user-authority gates.

## 23. Internal Consistency Checklist

- [x] MVP contains only catalog, approved analytics, and copy-product workflows.
- [x] Official OAuth only; no cookie/browser-automation fallback.
- [x] Every returned shop is a distinct organization-owned connection with per-shop token lifecycle.
- [x] Server-only secrets, ownership checks, RBAC, and audit requirements are specified across synchronous and asynchronous paths.
- [x] Copy is per-destination, previewed, explicitly confirmed, idempotent, and partial-success tolerant.
- [x] Unverified draft/unlisted and atomic variation behavior is called out as a gate, not assumed.
- [x] Analytics reflects only approved fields and distinguishes snapshots from collected history.
- [x] Business success retains the 30-day, comparable-workflow, at-least-50% requirement.
- [x] Unit, integration, E2E, and observability tests cover the deliberate-mode risks.
- [x] Implementation paths, rollout, rollback, risks, ADR, document inventory, staffing, and execution handoff boundaries are present.

