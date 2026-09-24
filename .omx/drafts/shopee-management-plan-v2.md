# Shopee Multi-Store Management: Implementation Plan v2

## 1. Status, Outcome, and Evidence Boundary

- Status: Planner revision for the second Architect review in a deliberate RALPLAN-DR lifecycle.
- Product: greenfield internal web application for one business, multiple users, and multiple Shopee shops.
- Outcome: after a 30-day pilot, comparable cross-shop product-management work for a comparable shop count takes at least 50% less operator time than the recorded baseline.
- Scope: centralized catalog, officially available product analytics, and human-confirmed product copy to multiple shops.
- Planning boundary: this artifact does not authorize implementation, real credential use, external spend, production deployment, destructive cleanup, or scope expansion.
- Primary evidence:
  - `.omx/specs/deep-interview-shopee-multi-store-management.md`
  - `.omx/research/shopee-open-platform-official-evidence.md`
  - `.omx/context/shopee-multi-store-management-20260908T172043Z.md`
  - `.omx/interviews/shopee-multi-store-management-20260908T172043Z.md`
  - `.omx/reviews/shopee-management-architect.md`

### 1.1 Corrected trace metadata

The authoritative interview lifecycle is **inactive and crystallized**, not active. Round 10 completed the interview with ambiguity `0.08`, established the 30-day pilot target of at least 50% lower workflow time, and closed the measurable-success gap. `.omx/deep-interview-state-input.json` is retained only as historical machine input: it still says `active: true` and its `rounds` array stops at Round 9, so those two fields are stale and must not override the crystallized specification or transcript. This v2 records the corrected trace without modifying the historical input file, consistent with its single-file output boundary.

### 1.2 External capability boundary

Official evidence supports seller authorization, a callback that may identify a shop or main account, exchange results that may include `shop_id_list`, rotating credentials, product retrieval, MediaSpace upload, item creation, variation initialization, and documented extra metrics. It does not prove the exact credential-sharing subject, endpoint permission, quota, market-specific field set, draft/hidden behavior, atomicity, or recovery facility available to this particular partner app. Each such fact is a dated implementation gate in the Shopee capability matrix, not an assumption.

## 2. Requirements Summary

### 2.1 MVP capabilities

1. **Centralized catalog:** authorize multiple shops officially; synchronize product base information and variants; filter/search by shop, status, category, SKU, stock state, and sync state; display freshness and actionable safe errors.
2. **Truthful analytics:** show only metrics the authorized app actually receives; initially consider documented 30-day views, cumulative sales, likes, ratings, and star rating; identify metric definition, window, collection completeness, observation time, and history boundary.
3. **Safe cross-shop copy:** select one source and multiple destinations; retrieve destination requirements; map and locally validate each destination; show editable previews; require explicit Owner/Admin confirmation; only then perform any MediaSpace or product mutation; isolate each destination as an idempotent job with auditable recovery states.

### 2.2 Users, roles, and tenancy

- One explicitly modeled organization; no public signup, billing, or multi-company MVP.
- Owner: organization/membership administration, shop authorization/disconnection, read workflows, preview, confirm/publish, manual sync.
- Admin: read workflows, preview, confirm/publish, manual sync; cannot manage shop credentials or memberships.
- Staff: read workflows and create/edit/validate previews; cannot confirm, publish, manage shops, trigger manual sync, or manage roles.
- Every request, command, job, query, log, and audit event is organization-scoped. UI visibility never substitutes for server authorization.

### 2.3 Non-goals

Orders/fulfillment, chat, ads/promotions, accounting/reconciliation, warehouse/other marketplaces, real-time inventory sync, general bulk editing, AI content generation, autonomous changes, native apps, public SaaS, and ongoing linkage of copied listings are excluded. Copy creates a new destination listing after confirmation; it does not synchronize later changes.

### 2.4 Invariants

- Official Open Platform only; no cookie or browser-automation fallback.
- Credentials, tokens, authorization headers, callback codes, OAuth state secrets, and raw upstream payloads containing secrets remain server-only and redacted.
- Organization, shop ownership, active membership, feature flag, connection/grant status, and immutable command hashes are enforced before asynchronous dispatch.
- Zero Shopee mutations occur before confirmation, including zero MediaSpace uploads.
- A request that may have reached Shopee is never blindly retried and is never relabeled as cancelled merely because an actor was later revoked.
- Unsafe listing shapes are blocked from MVP rather than allowed to become publicly incomplete.

## 3. RALPLAN-DR

### 3.1 Principles

1. **Official, least-privilege integration:** only documented flows and the minimum runtime/data authority.
2. **Subject-correct security:** distinguish organization/shop ownership from the upstream credential subject and bind every call to both.
3. **No unreviewed mutation:** local validation and hash-bound human confirmation precede every Shopee mutation.
4. **Durable ambiguity:** at-least-once delivery, crashes, revocation, and unknown upstream outcomes are explicit states with evidence-based recovery.
5. **Truthful coverage:** analytics and product support state what is complete, missing, unsupported, stale, unsafe, or unverified.

### 3.2 Top decision drivers

1. Security and correctness of credential rotation and externally visible writes.
2. MVP delivery and operations appropriate to one internal business.
3. Failure isolation, replay safety, traceability, and measurable truth under a dynamic external API.

### 3.3 Architecture options

#### Option A: modular TypeScript monolith, separate web/worker identities, PostgreSQL jobs (chosen)

One workspace contains Next.js web/BFF, worker, domain, database, Shopee, and observability packages. Web and worker deploy separately with different service identities and database roles. PostgreSQL owns domain state, outbox, scheduled triggers, leases, and jobs during the pilot.

Pros:

- Shared contracts and transactions with no message-broker split-brain in the pilot.
- Strong web/worker credential boundary without premature service distribution.
- `FOR UPDATE SKIP LOCKED`, unique constraints, leases, and immutable commands support explicit at-least-once processing.
- Modules remain extractable if measured capacity, team, or compliance needs change.

Cons:

- Queue load competes with application database load and requires disciplined indexes/retention.
- Package and database privilege boundaries need CI enforcement.
- Web and worker share migration cadence.

#### Option B: modular monolith with Redis-compatible queue

The same web/worker/package structure uses transactional outbox delivery into a separate durable broker.

Pros: mature delay/retry tooling and independent queue throughput.

Cons: extra infrastructure, broker/database split-brain handling, and duplicate enqueue modes before throughput evidence justifies them.

#### Option C: dedicated Shopee integration service

A credential-owning service exposes internal catalog/write commands to the web/domain system.

Pros: strongest credential/blast-radius boundary and independent scaling.

Cons: distributed authorization, deployment, contract, and transactional complexity are premature for one team and MVP volume.

#### Option D: synchronous full-stack plus cron

Pros: smallest infrastructure footprint.

Cons: cannot safely cover long-running media/item/variation boundaries, partial success, leases, or ambiguous outcomes; rejected for MVP writes.

### 3.4 Decision and evolutionary trigger

Choose Option A. Use PostgreSQL-backed jobs and scheduling first. Adopt Redis or a broker only after load evidence shows job polling/retention materially harms database SLOs or throughput targets cannot be met after indexing, batching, and worker tuning. Extract a Shopee service only when separate teams, independently scaling write volume, new marketplaces, or compliance demand a hard process/network boundary.

## 4. Recommended Stack and Repository Shape

Use currently supported stable/LTS versions at bootstrap and pin resolved versions only in lockfiles; this plan intentionally does not hard-pin versions.

- TypeScript on supported Node.js LTS.
- Next.js App Router for authenticated web/BFF.
- React with accessible primitives and typed forms.
- Auth.js-compatible OIDC against the business's existing provider; user key is `(oidc_issuer, oidc_subject)`, not email alone.
- PostgreSQL for business data, outbox, job queue, scheduler, audit, and migrations.
- Typed SQL/ORM plus explicit database constraints and transactions.
- Shared runtime schemas such as Zod at HTTP, config, command, job, and adapter boundaries.
- Envelope encryption through managed KMS/secret manager; distinct web and worker IAM principals.
- OpenTelemetry-compatible traces/metrics plus allowlist structured logging.
- Unit runner, isolated PostgreSQL integration tests, Shopee contract stub, and Playwright-style E2E.
- Containerized web/worker with separate staging and production identities.

```text
apps/
  web/
    app/(authenticated)/catalog/
    app/(authenticated)/analytics/
    app/(authenticated)/copy/
    app/(authenticated)/settings/shops/
    app/api/auth/shopee/start/route.ts
    app/api/auth/shopee/callback/route.ts
  worker/src/{dispatcher,scheduler,index}.ts
  worker/src/jobs/{catalog-sync,metric-collection,copy-destination,token-refresh}.job.ts
packages/
  auth/src/{session,authorize,command-authorization}.ts
  config/src/env.ts
  db/src/{schema,migrations,roles,views}/
  domain/src/{catalog,analytics,copy,rbac}/
  shopee/src/{client,oauth,products,media}/
  queue/src/{outbox,jobs,leases,scheduler,dead-letter}.ts
  observability/src/{logger,redaction,tracing,metrics,audit}.ts
tests/{unit,integration,contract/shopee,e2e,observability}/
docs/{requirements,architecture,security,testing,operations}/
```

CI enforces package dependency direction: UI -> application/domain contracts; application -> domain/ports; adapters -> ports; only database and Shopee adapter packages access their respective implementations. UI never imports database or Shopee clients.

## 5. Runtime and Database Authority Boundaries

### 5.1 Runtime identities

- **Web identity:** authenticates users; reads safe catalog/analytics projections; creates OAuth attempts; writes previews, confirmations, immutable command envelopes, and outbox rows. It cannot select token ciphertext, invoke KMS decrypt for Shopee credentials, update external-operation outcomes, or mutate publication mappings.
- **Worker identity:** reads confirmed immutable commands/jobs; reads ciphertext for the bound credential subject; can invoke KMS decrypt; updates sync, external-operation, publication, and job states. It cannot create/change memberships, create/alter confirmations, consume browser sessions, or authorize a different organization/shop than the command names.
- **Migration identity:** DDL/schema grants only during controlled deployment; unavailable to runtime containers.
- **Read-only support identity:** queries secret-free views with row/organization restrictions; cannot read ciphertext, OAuth state, commands containing sensitive mapped fields, or mutate data.

Web and worker use different database credentials, network identities, KMS policies, deployment service accounts, and secret sets. PostgreSQL grants and integration tests prove these denials, not merely application conventions.

### 5.2 Request-to-worker path

1. Web resolves `(issuer, subject)` to active user/membership and authorizes the action.
2. Every resource is loaded by `organization_id` plus resource ID; every target shop is verified as owned and active.
3. Preview validation creates immutable revisions but no external call.
4. Owner/Admin confirmation binds actor, role-at-confirmation, policy version, source/requirements/preview hashes, destinations, and feature-flag version.
5. In one database transaction, web writes confirmation, immutable per-destination command envelopes, audit rows, and outbox events.
6. Worker dispatcher revalidates current authorization and resource state before making a job dispatchable.
7. Worker leases and executes at least once. Every external call is preceded by a durable external-operation attempt. Commit/ack ordering and idempotent state transitions absorb duplicates.

## 6. Data Model

All organization-owned rows contain `organization_id`. External identifiers are scoped by partner application and market unless official uniqueness is proven.

| Entity | Required fields/invariants |
| --- | --- |
| `organizations` | `id`, name, settings, pilot configuration. |
| `users` | `id`, `oidc_issuer`, `oidc_subject`, email/display metadata, status; unique issuer+subject. |
| `memberships` | organization, user, Owner/Admin/Staff, active/revoked timestamps, authz revision; unique organization+user. |
| `partner_applications` | internal ID, market/environment, partner identifier reference, callback configuration, status; no partner key value. |
| `oauth_attempts` | organization, actor, partner app, state hash/authenticator, redirect binding, status (`PENDING/EXCHANGING/SUCCEEDED/FAILED/UNKNOWN/EXPIRED`), expiry, code fingerprint, consumed time. |
| `authorization_grants` | organization, partner app, grant kind (`SHOP/MAIN_ACCOUNT`), external grant subject, authorization expiry/status, source attempt; one seller authorization may map to several shops. |
| `credential_subjects` | grant, upstream credential-subject kind/ID, encrypted access/refresh token, expiries, key version, token revision, status; represents one refresh-token lineage. |
| `shop_connections` | organization, partner app, market, external shop ID, display/status/freshness metadata; unique scoped key. Contains no token. |
| `grant_shop_connections` | grant to shop mapping from authorized response; proves grant covers shop. |
| `shop_credential_bindings` | shop to credential subject, scope/effective dates/status; actual exchange evidence determines whether several shops share a subject or each has one. |
| `external_operation_attempts` | organization, aggregate/job, credential subject, operation kind, attempt UUID, request fingerprint, state (`PREPARED/STARTED/DEFINITELY_FAILED/SUCCEEDED/OUTCOME_UNKNOWN`), started/completed times, safe upstream correlation, upstream resource ID, safe error. One row precedes every mutating/token-exchange/refresh call. |
| `products` | organization/shop, scoped external item ID, SKU/name/status/category/stock, safe normalized fields, upstream timestamps, sync state; unique shop+item. |
| `product_variants` | product/shop, external model ID, SKU, tiers, safe price/stock fields. |
| `metric_definitions` | key, capability version, semantic kind, unit/window, aggregation/delta rules, support status. |
| `analytics_collection_runs` | organization/shop, capability version, endpoint/window, started/finished/as-of interval, expected/observed item counts, pages expected/observed, cursor, completeness (`COMPLETE/PARTIAL/FAILED`), tolerance, safe error. |
| `product_metric_snapshots` | product/shop, run, definition, value state (`VALUE/MISSING/UNSUPPORTED/NOT_RETURNED`), numeric value nullable, observed/as-of time. Explicit zero is `VALUE=0`. |
| `sync_runs`, `sync_errors` | shop, cursor/window, counts, completeness, result and safe actionable errors. |
| `copy_batches` | source shop/product, immutable source snapshot/hash, creator, status. |
| `destination_requirement_snapshots` | destination/category constraints, capability version, collected time, expiry, completeness, hash. |
| `copy_previews` | job destination, revision, normalized mapped fields, validation result/errors, preview hash; immutable revisions. |
| `copy_confirmations` | actor, membership/authz revision, policy/feature version, selected destinations, preview hashes, confirmation hash/time; immutable. |
| `copy_destination_commands` | immutable command version, batch/destination, confirmation, source/requirement/preview hashes, feature version, actor; unique destination per batch/version. |
| `copy_destination_jobs` | canonical state, command, attempts/lease info, safe error, upstream item ID; unique command. |
| `published_item_mappings` | job, destination shop, upstream item ID, item/variation status; unique job and scoped external item. |
| `outbox_events` | immutable event UUID, aggregate/command, type/version, created/dispatched time, retention; unique UUID. |
| `queue_jobs` | outbox event/job UUID, type/version, payload reference, state, available time, lease owner/expiry, attempt count, ack time; unique outbox event. |
| `scheduled_triggers` | task/target/time bucket, next due/status; unique task+target+bucket prevents duplicate schedule materialization. |
| `dead_letter_jobs` | original job, terminal reason, attempt history reference, replay status/actor/time. |
| `audit_events` | append-only safe actor/service/action/resource/shop/result/correlation metadata. |
| `pilot_workflow_measurements` | workflow version, shop/item counts, baseline/pilot duration, actor, time, comparability result. |

Composite foreign keys or repository predicates prevent cross-organization references. Command, confirmation, attempt, outbox, and audit rows are immutable except for narrowly defined state transitions. Ciphertext is excluded from ORM models used by web.

## 7. Credential Grant, OAuth, and Rotation Design

### 7.1 Ownership model

Three relationships are independently verified:

1. The organization owns the `shop_connection`.
2. An active `authorization_grant` covers that shop through `grant_shop_connections`.
3. An active `shop_credential_binding` identifies the credential subject authorized to call for that shop.

Never infer credential ownership from "first shop with a token." A main-account grant may cover several shops, while the returned credential could be shared or split. Persist the actual credential subject and scope observed in the current official exchange contract. All requests verify partner application, market, grant, binding, and target shop.

### 7.2 Authorization and exchange

1. Owner starts authorization; web persists short-lived state bound to organization, actor, partner app, exact callback, and browser/session context.
2. Web constructs only the documented seller authorization URL. Partner key remains in the worker/server secret boundary.
3. Callback atomically claims the state as `EXCHANGING`; replay, expiry, mismatch, or altered redirect fails before exchange.
4. Before token exchange, persist `external_operation_attempt(PREPARED)` with code fingerprint; transition to `STARTED` immediately before the call.
5. Normalize the response into one authorization grant, its returned shop list, one or more evidence-backed credential subjects, and bindings. Persist ciphertext and mappings before marking the attempt/callback successful.
6. Duplicate callback observes the prior attempt: return its safe result if succeeded; if exchange outcome is unknown and official code replay safety is not proven, require a new authorization rather than exchanging blindly.
7. Enqueue bootstrap sync separately per shop.

### 7.3 Rotation-safe refresh

Refresh lock scope is `credential_subject_id`, not `shop_connection_id`.

1. Persist a refresh attempt `PREPARED` and acquire a PostgreSQL advisory/row lock on the credential subject.
2. Re-read status, ciphertext revision, and expiry in the lock; skip if another worker already installed a newer revision.
3. Mark attempt `STARTED`, call refresh once, then atomically replace access/refresh ciphertext, expiries, increment revision, and mark success.
4. Jobs for all shops bound to the subject use the winning revision.
5. Definite invalid/revoked response marks the subject and all dependent connections `REAUTH_REQUIRED`.
6. If the process dies or database commit fails after Shopee may have rotated the refresh token, the old token may be invalid and the new token is unavailable. Unless current official behavior supplies a safe recovery facility, mark the prepared/started attempt `OUTCOME_UNKNOWN` during recovery and then the credential subject `REAUTH_REQUIRED`; do not retry the stale token.

The reconciler scans stale `STARTED` token attempts at startup/interval. It can resolve only from durable success data or a documented official recovery contract. Otherwise it fails closed to reauthorization.

### 7.4 Secret handling

- Envelope-encrypt tokens with KMS context containing organization, partner app, and credential-subject IDs.
- Worker alone has KMS decrypt permission; web cannot read token ciphertext at the database level.
- Validate server configuration by variable presence/shape, never values in diagnostics.
- Default-deny serializers exclude token-like names, cookies, headers, callback codes/state, signed URLs, and raw request/response bodies from logs/traces/audit/queue.

## 8. Asynchronous Delivery Contract

### 8.1 Semantics

The pilot contract is **at-least-once execution with idempotent state transitions**, not exactly once. PostgreSQL is authoritative for domain, outbox, queue, leases, schedule slots, attempts, and acknowledgements.

### 8.2 Outbox and enqueue

- The web transaction writes confirmed command + audit + an immutable UUID outbox event.
- Dispatcher claims outbox rows with `FOR UPDATE SKIP LOCKED` and a bounded lease.
- In the same PostgreSQL transaction, it inserts `queue_jobs` with unique `outbox_event_id` and marks the event dispatched. Duplicate dispatch becomes a no-op through the unique constraint.
- If a future external broker is adopted, mark outbox dispatched only after broker acknowledgement; duplicate broker delivery remains expected and uses the same stable event/job ID.

### 8.3 Worker lease, commit, and acknowledgement

- Worker claims an available job using an atomic lease (`lease_owner`, `lease_expires_at`) and heartbeats only while executing bounded work.
- Before each external call, it commits an `external_operation_attempt(PREPARED)` and then `STARTED` before sending.
- After a definite result, it commits attempt result, domain/job transition, published mapping, and audit event in one transaction.
- Only after that commit is the queue job acknowledged `SUCCEEDED` or rescheduled. Therefore a crash before commit causes redelivery; a crash after commit but before ack causes duplicate delivery that observes terminal/domain state and performs no repeated mutation.
- Expired leases are reclaimable. A stale worker may not commit if its lease generation/fencing token no longer matches.

### 8.4 Retry, poison, dead letter, and replay

- Retry only definite transient failures with capped exponential backoff, jitter, `Retry-After`, per-subject and per-shop concurrency limits.
- Schema/version mismatch, invariant failure, and repeatedly failing deterministic payloads are poison messages; quarantine without repeated Shopee calls.
- After configured attempts/age, move the job to dead letter with safe reason and attempt references.
- Replay is an Owner/Admin audited action that creates a new queue job referencing the original command and dead-letter row; it cannot change the immutable command or bypass state/idempotency/authorization checks.
- Retain outbox/job/attempt/dead-letter evidence for the pilot plus the approved audit period; purge only through a documented retention job that never removes unresolved external outcomes.

### 8.5 Scheduler deduplication

- Scheduler materializes work with unique `(task_type, target_id, scheduled_for_bucket)`.
- Advisory lock prevents concurrent schedulers from generating the same window; the unique constraint is final defense.
- Missed slots are backfilled only within a configured horizon; each derived job remains at least once and idempotent.
- Manual sync and scheduled sync share a deduplication key for overlapping shop/window/type work.

### 8.6 Capacity trigger

Measure queue scan latency, database CPU/IO, row churn, oldest-job age, lease contention, and application query SLO. Redis/broker adoption requires recorded evidence that PostgreSQL queue workload cannot meet agreed SLO after reasonable tuning. The migration must preserve event IDs, at-least-once semantics, external attempts, and database idempotency.

## 9. Exact Asynchronous Authorization and Revocation

### 9.1 Policy

- Staff may create/edit/validate previews only.
- Admin/Owner may confirm and publish.
- Owner alone may authorize/reauthorize/disconnect shops and manage memberships.
- Admin/Owner may trigger manual sync; Staff may not.

### 9.2 Checks before dispatch

For every confirmed command, dispatcher/worker revalidates:

1. Actor exists and membership is active.
2. Actor currently retains Admin or Owner permission for publication; role-at-confirmation is audit evidence, not permanent authority.
3. Organization owns source and destination shops/products.
4. Destination connection, authorization grant, credential subject, and binding are active and mutually scoped.
5. Confirmation, command, source, requirements, and preview hashes match and requirements remain within freshness policy.
6. Publication feature flag and supported-product-shape policy are enabled for organization/market/shape.
7. No terminal success, existing published mapping, unresolved external attempt, or newer command supersedes this work.

If any check fails **before the first external mutation attempt starts**, transition to a specific non-mutating state such as `AUTHORIZATION_REVOKED`, `SHOP_DISCONNECTED`, `COMMAND_STALE`, or `FEATURE_DISABLED` and audit it.

### 9.3 Revocation after a possible send

- After MediaSpace upload succeeds but before `add_item` starts, later revocation/disconnection blocks `add_item`; record staged media and run only an officially safe cleanup/expiry policy.
- Once an `add_item` attempt is `STARTED`, actor revocation, feature disable, or disconnect cannot prove the request did not reach Shopee. The job moves through `OUTCOME_UNKNOWN`, `PARTIAL_CREATED`, or a durable success/failure result; it is never represented as cancelled.
- Recovery may perform only read/reconcile or explicitly approved repair actions required to establish/safely contain the external result. It cannot initiate a fresh creation under revoked authority.
- Disconnect hides/blocks future writes immediately but preserves credential/attempt evidence needed for recovery under a restricted recovery state until safe closure or reauthorization.

## 10. Catalog and Analytics

### 10.1 Catalog sync

- Per-shop bootstrap and scheduled paginated reconciliation fetch item list, base info, model list, and approved extra info.
- Use scoped upserts and upstream markers/cursors when reliable. Do not mark missing/deleted until a complete authoritative scan or explicit status proves it.
- Track expected/observed pages/items and sync completeness. One shop failure does not block others.
- Apply per-credential-subject and per-shop limits because several shops may share one upstream quota/credential lineage.

### 10.2 Analytics collection completeness

Every metric snapshot belongs to `analytics_collection_run` with:

- shop, endpoint/capability version, metric definitions, requested upstream window;
- run start/end and `as_of_min`/`as_of_max` across pages;
- expected and observed items/pages when upstream provides counts;
- pagination cursor/completion evidence;
- completeness `COMPLETE`, `PARTIAL`, or `FAILED`;
- configured as-of tolerance and capability/permission status.

Value states are distinct:

- **Zero:** upstream explicitly returned numeric `0`; store `VALUE` with zero.
- **Missing:** item returned successfully but the expected field was absent/null under a supported capability.
- **Unsupported:** capability matrix/app/market says the metric is not available.
- **Not returned:** the item/page was outside an incomplete/failed collection; no value claim can be made.
- **Stale:** a previously valid observation exists but exceeds freshness/as-of tolerance.

Comparisons/aggregations require compatible metric definition and window, compatible capability version, as-of intervals within tolerance, and complete collection coverage. If not, show row-level observations with a coverage warning and disable aggregate/delta claims. Rolling 30-day views are not summed. Cumulative counters permit deltas only across valid ordered observations with reset/decrease handling. Ratings/star rating are not additive. App history starts at first complete collected observation and is never described as upstream backfill.

## 11. Copy Validation, Mutation, and Recovery

### 11.1 Canonical destination state machine

```text
DRAFT
 -> REQUIREMENTS_LOADING
 -> NEEDS_INPUT | INVALID | VALIDATED
 -> CONFIRMED
 -> QUEUED
 -> AUTHORIZATION_CHECK
 -> MEDIA_UPLOADING
 -> ITEM_CREATING
 -> VARIATION_INITIALIZING
 -> SUCCEEDED

Pre-send terminal/hold states:
AUTHORIZATION_REVOKED | SHOP_DISCONNECTED | COMMAND_STALE |
FEATURE_DISABLED | UNSUPPORTED_SHAPE | TERMINAL_FAILED

Recovery states:
RETRYABLE_FAILED | REAUTH_REQUIRED | REQUIREMENTS_STALE |
OUTCOME_UNKNOWN | PARTIAL_CREATED
```

`OUTCOME_UNKNOWN` is first-class and blocks automatic mutation retry.

### 11.2 Local preview, zero upstream mutation

1. Capture immutable allowlisted source snapshot/hash.
2. Fetch destination category/attribute/brand/limit/logistics requirements through read-only calls and record capability/completeness/freshness.
3. Validate source media metadata locally: URL/source reference, count, format, declared dimensions/size where available, ordering, and destination rules. Do not call MediaSpace.
4. Map destination fields; never copy source category/logistics/brand identifiers blindly.
5. Store immutable per-destination preview revision/hash over source snapshot, requirement snapshot, mapped payload, local media manifest, destination, and mapping/capability version.
6. Display all fields/errors; any edit generates a new validation result/hash.
7. Confirmation names selected valid destinations and exact hashes. Server repeats authorization/ownership/freshness/support checks and creates immutable commands.

Automated tests intercept all Shopee mutating adapters and prove no MediaSpace upload, `add_item`, variation initialization, listing-status change, or cleanup mutation occurs before confirmation.

### 11.3 Confirmed external sequence

1. Revalidate async authorization and supported shape.
2. Persist/mark MediaSpace external attempts and upload media as the **first** mutation.
3. Persist stable media results keyed by credential/shop and content hash where current API explicitly permits safe reuse.
4. Revalidate revocation/disconnect/feature state before starting item creation.
5. Persist `add_item` attempt `PREPARED`, then `STARTED`; send once.
6. On success, atomically store upstream item ID/published mapping before any variation operation.
7. Initialize variations only for shapes that passed the supported-shape gate.
8. Persist final result and audit; retries resume only from a definitely incomplete safe step.

### 11.4 Idempotency and external attempts

- Command identity: hash of organization + batch + destination shop + command version; unique database constraint.
- Payload fingerprint: source + requirements + preview hashes + adapter version.
- Each external call has a unique attempt UUID and immutable request fingerprint. If Shopee supports an official idempotency/correlation value, persist and reuse it exactly; otherwise do not invent guarantees.
- A completed job/published mapping makes duplicate job delivery a no-op.
- If `add_item` times out, connection drops, worker dies after send, or database commit fails before durable upstream item ID, set/recover to `OUTCOME_UNKNOWN`.
- Resolve `OUTCOME_UNKNOWN` only by: a durable upstream item ID already stored; an official correlation/idempotency lookup; an official search strategy that uniquely proves the created item; proof of absence strong enough under the documented API; or an audited Owner operator decision. No ordinary retry button resends creation while unresolved.
- Operator resolution records evidence and may mark `SUCCEEDED`, `PARTIAL_CREATED`, `DEFINITELY_FAILED`/retryable, or terminal manual handling. It never deletes attempt history.

### 11.5 Supported-product-shape gate

Create a market/capability/product-shape matrix covering simple items, single/multi-tier variants, media requirements, draft/hidden support, visibility timing, variation atomicity, safe disable, lookup/reconciliation, and repair behavior.

- A shape is MVP-supported only if confirmation can lead to a complete acceptable listing or any intermediate public state has a documented, tested containment/repair guarantee.
- If `add_item` becomes public before required variation initialization and there is no guaranteed safe draft/disable/repair path, all variant shapes requiring that sequence are `UNSUPPORTED_SHAPE` for MVP.
- If simple listings are atomic enough under the verified contract, they may remain supported independently.
- Changing this invariant to permit publicly incomplete listings is explicit user scope/product-risk approval, not an implementation decision.

## 12. Security, Audit, and Observability

### 12.1 Security controls

- Threat model OAuth replay/substitution, credential-subject confusion, shop IDOR, SSRF/media abuse, stored XSS, CSRF, queue tampering, stale command replay, secret leakage, and privilege escalation.
- Restrict outbound hosts; validate media origin/redirect/content type/size; prevent private-network access.
- Escape product content and sanitize approved rich text.
- Secure HTTP-only same-site sessions, CSRF defense, strict CSP/headers, rate limits, and recent-auth for shop/membership changes.
- CI performs dependency, secret, static, container, migration, database-grant, and package-boundary checks.

### 12.2 Audit

Audit authorization/grant/binding changes, token refresh result, sync, analytics collection, preview revision, confirmation, dispatch denial, every external attempt result, recovery decision, publication, role/connection changes, dead-letter replay, and feature-flag changes. Store safe IDs/hashes/codes only; no raw headers, tokens, state, callback code, or signed payload.

### 12.3 Metrics and alerts

- OAuth/grants: state failures, duplicate/unknown exchanges, shops per grant, subjects per grant, reauth required.
- Refresh: subject lock wait, revision wins, unknown rotation, bound shops affected.
- Queue: outbox age, dispatch duplicates, lease expiry/steal, fencing rejection, retries, poison/dead letter/replay, scheduler dedup conflicts.
- Copy: pre-confirm mutation counter (must remain zero), attempts by operation/outcome, unknown/partial age, duplicate-prevention hits, state durations.
- Analytics: collection completeness, count/page coverage, as-of spread, stale/missing/unsupported/not-returned rates, disabled comparisons.
- Security: authorization denials/revocation-before-dispatch, redaction canary failures, KMS denial, database-role denial.
- Cardinality budget: use bounded operation/state/error/capability labels; keep user/shop/job IDs in logs/traces, never metric labels. Establish ingestion/retention cost limits before production.

Correlations link request -> confirmation -> command -> outbox -> queue lease -> external attempt -> result/audit without secret payloads.

## 13. Phase Plan, Documents, and Approval Gates

Documents are phase-gated; not every document blocks Phase 1.

### Phase 0: entry baseline and external unknown register

Entry: crystallized spec and official-evidence note exist.

Work:

- Finalize `.omx/plans/shopee-management-plan.md` after Architect/Critic lifecycle.
- Create `docs/requirements/PRD.md` and `docs/requirements/acceptance-criteria.md` from the approved plan.
- Start `docs/requirements/shopee-capability-matrix.md` with every external unknown marked `UNKNOWN`, owner, evidence date, and the phase it blocks.
- Define baseline workflow in `docs/operations/pilot-measurement.md` sufficiently to collect pre-adoption timing.

Owner: product/technical leader; Shopee evidence entries owned by integration lead; acceptance mapping owned by test lead.

Approval gate to Phase 1: local plan lifecycle complete, requirement traceability reviewed, no unresolved scope ambiguity. Host execution receipt still required before implementation.

### Phase 1: foundation, identity, and privilege separation

Paths:

- workspace configs; `apps/web/app/`; `apps/worker/src/index.ts`
- `packages/config/src/env.ts`
- `packages/db/src/schema/{organizations,users,memberships,audit,outbox,queue}.ts`
- `packages/db/src/roles/{migration,web,worker,readonly}.sql`
- `packages/auth/src/{session,authorize,command-authorization}.ts`
- `packages/observability/src/{logger,redaction,tracing,metrics}.ts`

Documents required during this phase: `docs/architecture/ADR-001-modular-monolith.md`, `docs/architecture/data-model.md`, initial `docs/security/threat-model.md`, `docs/testing/test-strategy.md`.

Owner: architecture/foundation executor; security reviewer approves runtime/DB/KMS grants; test lead approves role/redaction tests.

Exit: roles are technically denied outside scope; outbox/queue lease prototype passes duplicate/crash tests; production config fails closed.

### Phase 2: authorization grants and credential subjects

Paths:

- OAuth web routes and settings UI
- schema for partner apps, OAuth attempts, grants, credential subjects, shop mappings/bindings, external attempts
- `packages/shopee/src/oauth/{authorization,exchange,refresh}.ts`
- token refresh/recovery worker

Documents required before this phase exits: capability-matrix entries for callback/exchange subject shapes and rotation behavior; `docs/security/secret-handling.md`; `docs/requirements/credential-subject-model.md`; reauthorization runbook.

Owner: Shopee/security executor; architecture approves subject mapping; verifier approves rotation/crash evidence.

Exit: shop/main-account fixtures and actual approved staging evidence map correctly; shared/independent refresh tests pass; crash-after-rotation fails closed.

### Phase 3: catalog and complete collection model

Paths: catalog/sync schemas and domain; product read adapters; collection-run model; worker jobs; catalog UI.

Phase-dependent docs: capability entries for product read fields/pagination/rates; `docs/requirements/analytics-semantics.md` initial coverage definitions.

Owner: domain/data executor; test lead approves incomplete pagination/reconciliation tests.

Exit: required filters/details work, ownership holds, incomplete sync never asserts deletion/completeness.

### Phase 4: analytics

Paths: metric definitions/snapshots/collection runs, collection job, analytics UI.

Required exit documents: finalized metric portion of capability matrix and `analytics-semantics.md`.

Owner: analytics/domain executor; product owner approves labels; verifier checks incompatible/incomplete coverage.

Exit: zero/missing/unsupported/not-returned/stale are distinguishable and aggregates are coverage-safe.

### Phase 5: local copy preview only

Paths: copy snapshots/requirements/previews/confirmations/commands; mapper/validator/hash; destination read adapters; preview UI.

Required exit documents: `docs/requirements/copy-product-state-machine.md`, `docs/requirements/rbac-matrix.md`, requirement capability entries.

Owner: copy domain + web lanes; security/test approve confirmation and zero-mutation evidence.

Exit: ten independent previews; invalid/unsupported shapes blocked; zero mutating Shopee calls.

### Pre-write gate (blocks Phase 6)

Before any write-enabled implementation or feature flag:

- Capability matrix confirms MediaSpace ordering, `add_item` response/correlation, visibility/draft behavior, variation atomicity, safe disable/repair, and supported shapes per target market.
- `docs/operations/external-outcome-recovery.md` and write incident runbook are approved.
- Unit/integration/E2E tests prove confirmation binding, revocation rules, external attempt durability, all crash boundaries, and no duplicate creation.
- Product owner explicitly accepts the supported-shape list; unsafe shapes remain blocked.

Approvers: product owner, architecture, security, test/verifier, Shopee integration lead.

### Phase 6: confirmed media/item/variation execution

Paths: MediaSpace/add-item/variation adapters; external attempts; publication/recovery worker; job result/recovery UI.

Owner: Shopee/security + domain executors; independent verifier owns pre-write gate evidence.

Exit: idempotent seven-valid/three-invalid pressure case passes; worker death at every boundary is safe; unknown outcomes cannot auto-retry.

### Phase 7: pre-production hardening and pilot

Pre-production documents: complete `docs/operations/runbooks.md`, `rollback.md`, `external-outcome-recovery.md`, final threat model, secret handling, test report, capability matrix, deployment/backup/restore procedures, and pilot protocol.

Owner: leader/operations; security and verifier approve; user retains authority for credential use, cost, and production deployment.

Exit: all release gates pass, controlled read-only alpha reconciles with Seller Centre, write feature is gradually enabled, baseline is frozen, and the 30-day pilot can produce a comparable result.

## 14. Testable Acceptance Criteria

1. An Owner authorization returning one or many shops persists one grant, the exact observed credential subject(s), all shop mappings/bindings, and independent connections without global token selection.
2. Shared-subject shops serialize refresh on credential subject; independent subjects refresh independently. No stale revision overwrites a rotated credential.
3. A crash/database failure after possible refresh rotation results in `OUTCOME_UNKNOWN` then `REAUTH_REQUIRED` unless a tested official recovery path proves the new credential.
4. Duplicate callback/exchange delivery produces one durable successful grant mapping or an explicit unknown/restart state, never duplicate grants or blind code exchange.
5. Canary partner key/token/state/code/cookie/header values are absent from client payload, UI, database safe views, queue payloads, logs, traces, metrics, audit, and error reporting.
6. Catalog filters work across shop/status/category/SKU/stock/sync state; forged organization/shop/product IDs are denied.
7. Analytics exposes definition/window/as-of/freshness/completeness and correctly distinguishes explicit zero, missing, unsupported, not returned, and stale.
8. Analytics aggregate/comparison is disabled for partial runs, incompatible capability versions/windows, or as-of spread outside tolerance.
9. One source and ten destinations produce ten local previews. Three invalid/unsupported destinations remain unconfirmable; seven valid destinations may be selected.
10. Before confirmation, an adapter mutation ledger proves zero MediaSpace, add-item, variation, status, or cleanup calls.
11. Confirmation is accepted only from active Owner/Admin and binds exact source/requirement/preview hashes, destinations, policy, actor authz revision, and feature version.
12. Demotion/deactivation, shop disconnect, stale requirements, feature disable, or ownership mismatch before the first external attempt prevents dispatch with the exact safe state.
13. After a MediaSpace success but before add-item, revocation prevents item creation; after add-item may have been sent, revocation yields recovery rather than cancellation or resend.
14. Every Shopee mutation has a durable `external_operation_attempt` that was committed before send and ends definite or `OUTCOME_UNKNOWN`.
15. Worker death before send, during send, after response, after domain commit, and before queue ack does not produce an automatic second `add_item`.
16. `OUTCOME_UNKNOWN` is visible, blocks normal retry, preserves attempts, and resolves only through approved evidence/operator workflow.
17. Unsupported variant/visibility shapes cannot be confirmed or dispatched. No MVP-supported flow can knowingly leave a publicly incomplete listing without a documented tested containment guarantee.
18. Duplicate outbox dispatch, duplicate enqueue/delivery, expired lease, lost ack, dead-letter replay, and scheduler collision preserve one logical command and no duplicate listing.
19. Web, worker, migration, and read-only database roles pass allow/deny tests; web cannot select ciphertext or mutate publication outcomes, worker cannot manage memberships/confirmations.
20. Every sensitive lifecycle action emits a correlated secret-free audit event.
21. Local reads remain available with stale indicators during Shopee outage; queues back off within configured bounds.
22. Desktop/tablet/mobile and keyboard/screen-reader core flows pass agreed accessibility checks.
23. The 30-day report compares the frozen workflow definition, shop/item cohort, and timing method and either demonstrates at least 50% reduction or explicitly records failure to meet the goal.

## 15. Expanded Deliberate Test Plan

### 15.1 Unit

- Role/action matrix, ownership predicates, membership/authz revision, feature version, and last-Owner rule.
- OIDC issuer+subject identity and OAuth state/callback binding/replay.
- Grant/shop/credential-subject resolution for shared and independent token subjects.
- Refresh-lock key and state recovery; rotation revision and fail-closed unknown path.
- Database-role query surface definitions and safe views.
- Outbox/job IDs, scheduler slots, lease fencing, retry classifier, poison threshold, replay authorization.
- Catalog freshness/completeness.
- Metric value-state decoder and compatible-coverage/aggregation rules.
- Copy mapping, local media rules, requirement completeness, preview/confirmation/command hashes.
- Canonical copy transition table including `OUTCOME_UNKNOWN`, `PARTIAL_CREATED`, revocation, unsupported shape.
- External-attempt result classification and legal recovery evidence.
- Secret allowlist serializer/redactor with nested/query/header/error canaries.

### 15.2 Integration and crash-boundary matrix

- Database constraints for cross-org denial, scoped external IDs, grant/binding integrity, immutable commands, unique event/job/destination/published mapping.
- Actual PostgreSQL grants prove web/worker/migration/read-only allow/deny lists.
- Callback fixtures: shop, main account with many shops, shared subject, per-shop subjects, duplicate callback, exchange timeout, response then DB failure, crash before/after attempt transitions.
- Refresh fixtures: simultaneous shops sharing subject, independent subjects, definitive invalid token, timeout, response then transaction failure, process death before/after Shopee rotation.
- Outbox: crash before domain commit; after commit/before dispatch; during dispatch transaction; duplicate dispatcher; unique insert conflict.
- Queue: death before lease; after lease/before attempt; after `PREPARED`; after `STARTED` before send; during send; after response before result commit; after result commit before ack; stale lease/fencing; duplicate delivery; poison; dead-letter replay.
- Scheduler: two schedulers same slot, missed-slot backfill, manual/scheduled overlap, clock skew within defined bounds.
- Copy external sequence for each operation:
  - Media upload: definite fail, timeout/unknown, success then crash, revocation after success.
  - `add_item`: death immediately before socket send, connection loss during send, response lost, success response then DB failure, durable mapping then crash.
  - Variation: definite fail and success after durable item ID, with shape-specific containment behavior.
- Prove zero mutating stub calls for all preview/validation/confirmation-failure paths.
- Outcome resolver accepts only durable ID, official correlation lookup, documented proof of absence, or audited operator decision; ordinary retry denied.
- Catalog/analytics pagination: expected count mismatch, duplicate/missing page, cursor loop, late page, incompatible as-of interval/capability version.
- Secret canary scan across database safe views, job payloads, logs/traces/audit/error sinks.

### 15.3 E2E

- Owner OIDC -> multi-shop authorization -> bindings -> bootstrap state using controlled stub/sandbox.
- Staff/Admin/Owner UI plus forged HTTP requests for every protected action.
- Demote/deactivate confirmer and disconnect destination between confirmation/dispatch; assert exact non-mutating state.
- Revoke after media upload and after ambiguous add-item; assert no fresh creation/cancellation fiction.
- Catalog filters/details with mixed shop freshness/errors.
- Analytics with zero/missing/unsupported/not-returned/stale and complete/partial coverage; invalid comparison disabled.
- Ten-shop preview: seven valid, three invalid/unsupported; edit/revalidate; confirm seven; independent results.
- Double click, HTTP replay, duplicate queue delivery, lease steal, worker restart, lost ack, replay; no duplicate destination item.
- Requirement/capability/feature version changes invalidate confirmation.
- Unknown outcome blocks retry and provides evidence-based Owner recovery UI.
- Supported simple/variant shape matrix; unsupported public-incomplete sequence cannot start.
- Shopee outage leaves safe read-only use and visible delayed jobs.
- Responsive/keyboard/focus/error/screen-reader workflows.
- Pilot baseline and comparable report.

### 15.4 Observability

- Correlation chain from confirmation through command/outbox/job/attempt/upstream/result/audit.
- Alert simulations: OAuth exchange unknown, credential rotation unknown, reauth, queue lag/lease storm, poison/dead letter, outcome unknown age, partial creation, incomplete analytics, pre-confirm mutation counter, DB-role/KMS denial.
- Canary-secret absence from every sink and no high-cardinality IDs in metric labels.
- Dashboard/runbook exercise identifies affected organization, grant/credential subject, shop, command, and attempt without secrets.
- Load test representative catalog and destination counts; record PostgreSQL job scan/lease overhead and decide against/for broker only from results.

## 16. Rollout and Stop Rules

1. Local/CI uses Shopee stub, isolated PostgreSQL, deterministic clocks, and secret canaries.
2. Approved staging credentials verify capability matrix, grant/subject mapping, rotation, rates, collection completeness, media/item/variation behavior, visibility, and recovery.
3. Read-only alpha enables OAuth/catalog/analytics for Owner plus one operator and reconciles with Seller Centre.
4. Write pilot feature flag starts only after pre-write gate; begin one supported source shape/one destination, then expand.
5. Freeze baseline and run 30-day pilot with weekly operational review.
6. Go/no-go requires security invariants, recovery evidence, operational capacity, and a truthful outcome report.

Rollback disables new confirmations/dispatch first, drains or holds pre-send jobs, and keeps read-only/audit/recovery surfaces. Any attempt that may have reached Shopee stays in recovery; rollback never deletes evidence or falsely cancels it.

## 17. Pre-Mortem

### Scenario 1: shared main-account refresh lineage is treated as per-shop

- Signal: clustered 401s, shops invalidate each other's refresh token, inconsistent revisions.
- Cause: lock and token storage keyed to shop rather than credential subject.
- Prevention: explicit grant/subject/binding model, subject-scoped lock, shared-subject concurrency tests.
- Recovery: pause all bound shops, mark subject `REAUTH_REQUIRED`, reauthorize, replay only safe jobs.

### Scenario 2: ambiguous `add_item` plus at-least-once redelivery creates duplicates

- Signal: multiple upstream item IDs, growing unknown attempts, duplicates after lost ack/worker death.
- Cause: no durable pre-send attempt or retry after uncertain commit.
- Prevention: external attempts, first-class `OUTCOME_UNKNOWN`, persisted item mapping, lease fencing, no blind resend.
- Recovery: disable dispatch, reconcile with official evidence, resolve via Owner workflow, preserve all attempts.

### Scenario 3: outbox/queue/scheduler split or incomplete analytics creates false confidence

- Signal: duplicate/missing jobs, old outbox rows, repeated schedule slots, shop comparison changes with missing pages.
- Cause: implicit delivery semantics or aggregates over partial/incompatible collections.
- Prevention: PostgreSQL atomic enqueue, unique IDs/slots, leases/acks, complete collection runs and comparison gates.
- Recovery: halt affected scheduler/aggregate, replay durable events safely, recollect full windows, label prior results incomplete.

## 18. Risks and Mitigations

| Risk | Mitigation/gate |
| --- | --- |
| Credential scope differs by callback/exchange shape | Persist observed grant/subject/binding; capability fixtures and staging verification. |
| Refresh succeeds upstream but persistence fails | Durable attempt; unknown -> reauthorization absent official recovery. |
| Product creation is visible before variation | Supported-shape gate; exclude unsafe shapes unless user changes invariant. |
| Timeout after mutation | First-class external attempt/outcome unknown; never blind retry. |
| Actor revoked after confirmation | Current authorization before dispatch; recovery semantics after possible send. |
| PostgreSQL queue affects application | Capacity metrics/tuning; broker only on measured trigger. |
| Duplicate/lost scheduled jobs | Unique schedule slot, advisory lock, at-least-once idempotency. |
| Partial analytics appears complete | Collection run counts/pages/as-of/capability and aggregate disablement. |
| Dynamic endpoint fields/permissions/rates | Dated capability matrix, contract tests, feature gates. |
| Secret leakage | runtime/DB/KMS separation, allowlist telemetry, canary gates. |
| Cross-org/shop IDOR | organization-scoped keys/queries, grant/binding checks, adversarial tests. |
| Queue/attempt retention cost | bounded safe metadata, retention policy, unresolved evidence exemption, cardinality budget. |
| Scope creep | PRD/non-goals/change-control boundary. |
| Biased 50% claim | frozen comparable workflow/shop/item/time method before adoption. |

## 19. ADR-001: Modular Monolith with PostgreSQL At-Least-Once Jobs

### Status

Proposed v2; requires Architect then Critic approval and does not authorize execution.

### Context

The MVP combines low-latency internal reads with rotating upstream credentials and multi-step, externally visible writes. Exact-once delivery is unavailable across PostgreSQL and Shopee. The application must survive duplicate delivery, crashes at each network/commit boundary, actor revocation, and incomplete upstream data.

### Decision drivers

Security/write correctness; MVP operational simplicity; durable failure isolation and evidence.

### Decision

Use one TypeScript workspace with modular boundaries, separately deployed web and worker service identities, separate database roles, PostgreSQL source of truth, transactional outbox, PostgreSQL-backed job queue/scheduler, immutable versioned commands, credential-subject-scoped rotation, durable external attempts, and at-least-once idempotent execution.

### Alternatives

- Redis/broker: defer until capacity measurements justify split-brain and infrastructure cost.
- Dedicated Shopee service: defer until organizational/scaling/compliance trigger.
- Synchronous/cron: reject for unsafe write and recovery semantics.

### Why chosen

PostgreSQL keeps domain/outbox/job transitions atomic during the pilot, while separate identities/roles create a meaningful credential and mutation boundary. Durable attempts acknowledge that Shopee calls cannot join a database transaction.

### Consequences

- Positive: fewer distributed components, auditable crash handling, strong runtime permissions, explicit replay semantics.
- Negative: database queue load/retention and careful lease/index design; some ambiguous external outcomes require human recovery.
- Invariant: no architecture choice creates exactly-once Shopee writes; idempotency plus reconciliation remain mandatory.

### Follow-ups

- ADR for credential-subject mapping after current official/staging evidence.
- ADR for supported product shapes/listing visibility.
- ADR for broker migration only if capacity trigger fires.
- Verify package boundaries, DB grants, KMS policies, and crash matrix before write enablement.

## 20. Requirement-Document Inventory by Gate

### Existing evidence and lifecycle artifacts

| Path | Use/status |
| --- | --- |
| `.omx/context/shopee-multi-store-management-20260908T172043Z.md` | Greenfield context. |
| `.omx/interviews/shopee-multi-store-management-20260908T172043Z.md` | Ten-round transcript summary; includes Round 10. |
| `.omx/specs/deep-interview-shopee-multi-store-management.md` | Primary crystallized requirements. |
| `.omx/research/shopee-open-platform-official-evidence.md` | Dated official evidence and limitations. |
| `.omx/deep-interview-state-input.json` | Historical input with stale `active` flag and missing Round 10 array entry; non-authoritative for closure metadata. |
| `.omx/reviews/shopee-management-architect.md` | Architect ITERATE findings addressed by this revision. |
| `.omx/drafts/shopee-management-plan.md` | Preserved v1 Planner draft. |
| `.omx/drafts/shopee-management-plan-v2.md` | This revision. |

### Phase 0 entry/baseline documents

| Path | Owner | Approval gate |
| --- | --- | --- |
| `.omx/plans/shopee-management-plan.md` | Planner/leader | Architect -> Critic lifecycle; host receipt still separate. |
| `docs/requirements/PRD.md` | Product lead | Requirement trace review before Phase 1. |
| `docs/requirements/acceptance-criteria.md` | Test lead | Product + architecture review before Phase 1. |
| `docs/requirements/shopee-capability-matrix.md` (initial unknown register) | Shopee lead | Unknowns have owners/blocking phases before Phase 1. |
| `docs/operations/pilot-measurement.md` (baseline section) | Product/operations | Comparable baseline method approved before adoption. |

### Phase-dependent design documents

| Path | Required by | Owner/approval |
| --- | --- | --- |
| `docs/architecture/ADR-001-modular-monolith.md` | Phase 1 exit | Architecture + Critic. |
| `docs/architecture/data-model.md` | Phase 1/2 schema | Domain + architecture. |
| `docs/architecture/integration-contracts.md` | Each adapter phase | Domain/Shopee leads. |
| `docs/security/threat-model.md` (initial) | Phase 1 exit | Security reviewer. |
| `docs/testing/test-strategy.md` | Phase 1 exit | Test lead/verifier. |
| `docs/requirements/credential-subject-model.md` | Phase 2 exit | Shopee/security/architecture. |
| `docs/security/secret-handling.md` | Phase 2 exit | Security/verifier. |
| `docs/requirements/analytics-semantics.md` | Phase 4 exit | Analytics/product/verifier. |
| `docs/requirements/copy-product-state-machine.md` | Phase 5 exit | Domain/security/test. |
| `docs/requirements/rbac-matrix.md` | Phase 5 exit | Product/security/test. |

### Pre-write documents

| Path | Owner | Approval |
| --- | --- | --- |
| Completed write/visibility/variation portions of `shopee-capability-matrix.md` | Shopee lead | Product + architecture + verifier. |
| `docs/operations/external-outcome-recovery.md` | Operations/domain | Security + product + verifier. |
| Write incident section of `docs/operations/runbooks.md` | Operations | Staging exercise passes. |
| Pre-write test evidence report | Test/verifier | All crash/revocation/zero-mutation gates pass. |

### Pre-production documents

| Path | Owner | Approval |
| --- | --- | --- |
| `docs/operations/runbooks.md` | Operations | Exercised in staging. |
| `docs/operations/rollback.md` | Operations/architecture | Restore/hold/replay drill passes. |
| Final threat model and secret-handling documents | Security | No critical open finding. |
| Final capability matrix | Shopee lead | All enabled features confirmed. |
| Deployment, backup, restore, and migration procedures | Platform/operations | User approves production/cost. |
| Final `pilot-measurement.md` | Product/operations | Baseline frozen before 30-day pilot. |

This inventory is complete for the agreed MVP; documents become blocking only at their named gate.

## 21. Agent Staffing and Authorized Future Handoff

Relevant available roles: `explore`, `researcher`, `dependency-expert`, `architect`, `critic`, `executor`, `test-engineer`, `debugger`, `verifier`, `code-reviewer`, `designer`, `writer`, `git-master`, and `code-simplifier`.

After final consensus and a verified official host receipt, use `$ultragoal` as the durable leader-owned phase/exit-criteria ledger and `$team` for bounded parallel lanes:

1. Leader/architect, high/xhigh: phase gates, schemas/contracts, integration, final verification.
2. Shopee/security executor, high: grant/subject OAuth, encryption/rotation, capability matrix, external attempts.
3. Domain/data executor, high: PostgreSQL outbox/jobs/scheduler, catalog, analytics completeness, copy state/idempotency.
4. Web/designer executor, medium/high: role-correct catalog/analytics/preview/recovery UI and accessibility.
5. Test engineer, high: official-contract stub, database grants, concurrency/crash matrix, E2E/observability.
6. Verifier/code reviewer, high: independent security/invariant/evidence gate.

Assign non-overlapping package/migration ownership. Sequence foundation -> credential model -> read sync -> analytics/local preview -> pre-write gate -> write worker -> production gate. A future runtime hint may use `omx team 5:executor "Execute approved phases with explicit package ownership and return exit-criterion evidence"`, adapted to installed runtime and only after receipt authorization. `$ralph` is a narrow single-owner fallback, not the default; `$autoresearch-goal` is for unresolved official capability research; `$performance-goal` is for evidence-based queue/query optimization after baselines.

Team verification requires test-engineer scenario evidence, independent verifier review, and leader execution of phase-wide type/lint/test/build/security/DB-grant gates. No lane self-approves its own sensitive boundary.

Until a documented non-user-mintable host receipt is verified, the local consensus gate remains `complete:false` with `blocked_reason:"documented_host_consensus_receipt_unavailable"`.

## 22. Revision Changelog: Architect ITERATE -> v2

| Architect required change | v2 correction |
| --- | --- |
| 1. No pre-confirmation mutation | Sections 2.4, 11.2, 11.3, acceptance 10, and crash tests prohibit MediaSpace and every other mutation before confirmation. |
| 2. Credential subject and refresh scope | Sections 6 and 7 add partner app, authorization grant, credential subject, shop mappings/bindings, subject-scoped lock, shared/independent behavior, and crash-after-rotation -> unknown/reauth. |
| 3. First-class `OUTCOME_UNKNOWN` and attempts | Sections 6, 7, 11, acceptance 14-16, and crash matrix define durable attempts before calls, canonical unknown state, evidence-only resolution, and no blind retry. |
| 4. Block unsafe product shapes | Sections 11.5, pre-write gate, acceptance 17, and E2E matrix exclude any shape that can become publicly incomplete without guaranteed containment. |
| 5. Explicit async delivery/PostgreSQL first | Sections 3.3-3.4 and 8 define at-least-once semantics, UUIDs, atomic enqueue, leases/fencing, commit-before-ack, duplicates, poison/DLQ/replay, retention, scheduler dedup, and measured broker trigger. |
| 6. Exact async RBAC/revocation | Sections 2.2, 5.2, and 9 remove conditional permissions and define revalidation before dispatch plus recovery, not cancellation, after possible send. |
| 7. Analytics run completeness | Sections 6 and 10.2 model runs, counts/pages/window/capability/as-of tolerance and distinguish zero/missing/unsupported/not-returned/stale. |
| 8. Phase-gated documents | Sections 13 and 20 separate entry, phase-dependent, pre-write, and pre-production documents with owners and approvals. |
| 9. Trace metadata | Section 1.1 and inventory explicitly record inactive/crystallized lifecycle and Round 10 while identifying stale historical JSON fields. |
| Synthesis: separate identities/roles | Section 5 specifies web/worker/migration/read-only service, database, KMS, and mutation authorities with allow/deny tests. |
| Validation expansion | Acceptance criteria 1-23 and Section 15 cover shared credentials, callback ordering, rotation crash, every add-item boundary, duplicate/lost delivery, revocation, unsafe shapes, and incomplete analytics. |
| Optional improvements adopted | Issuer+subject identity, scoped shop IDs, queue split/coverage pre-mortem, database roles, package CI boundaries, and observability cardinality/cost budget appear in Sections 4-6, 12, and 17. |

## 23. Internal Consistency and Stop Checklist

- [x] Scope and 50%/30-day outcome match the crystallized interview.
- [x] Trace lifecycle is corrected to inactive/crystallized with Round 10 recorded.
- [x] Official integration only; all external capability uncertainty is gated.
- [x] Shop ownership, authorization grant, and credential subject are separate.
- [x] Web and worker identities/database/KMS authorities are separate and testable.
- [x] PostgreSQL-first at-least-once delivery has complete dispatch/lease/ack/replay/scheduler semantics.
- [x] No MediaSpace or other mutation occurs before confirmation.
- [x] Actor revocation and shop disconnect rules are exact before and after possible send.
- [x] External attempts and `OUTCOME_UNKNOWN` are canonical, durable, and non-retryable without evidence.
- [x] Unsafe listing/variation shapes are excluded from MVP.
- [x] Analytics completeness and value absence states are explicit.
- [x] Documents are blocked only at relevant phase gates and have owners/approvers.
- [x] Acceptance and unit/integration/E2E/observability tests cover the Architect validation list.
- [x] RALPLAN principles/options, ADR, pre-mortem, risks, inventory, and staffing/handoff remain present.

