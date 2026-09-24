# Rencana Final: Shopee Multi-Store Product Management

## 1. Status, Pemilik, dan Batas Otorisasi

- Status: **approved planning package** berdasarkan Planner v2, Architect `APPROVE`, dan Critic `APPROVE` yang dilaporkan oleh orchestration context.
- Pemilik rencana: Product/Technical Lead.
- Scope: aplikasi web internal satu organisasi untuk katalog lintas toko, analitik produk yang tersedia secara resmi, dan salin produk lintas toko.
- Target bisnis: setelah pilot 30 hari, waktu workflow pengelolaan produk lintas toko yang setara turun minimal 50% dibanding baseline.
- Gate eksekusi: rencana ini tidak mengizinkan penulisan source, penggunaan credential nyata, pembelian layanan, deployment production, operasi destruktif, atau perluasan scope.
- Consensus gate tetap `complete:false` dengan `blocked_reason:"documented_host_consensus_receipt_unavailable"` sampai official host receipt yang non-user-mintable tersedia dan terverifikasi.

### Bukti sumber

- `.omx/specs/deep-interview-shopee-multi-store-management.md`
- `.omx/research/shopee-open-platform-official-evidence.md`
- `.omx/context/shopee-multi-store-management-20260908T172043Z.md`
- `.omx/interviews/shopee-multi-store-management-20260908T172043Z.md`
- `.omx/drafts/shopee-management-plan-v2.md`
- `.omx/reviews/shopee-management-architect.md`
- `.omx/reviews/shopee-management-architect-v2.md`
- `.omx/reviews/shopee-management-critic.md`

Metadata interview yang benar adalah **inactive/crystallized**. Round 10 menutup interview pada ambiguity `0.08` dan menetapkan target 50%/30 hari. `.omx/deep-interview-state-input.json` adalah historical input dengan flag `active` dan array Round 10 yang stale; ia bukan authority untuk status closure.

## 2. Outcome, Scope, dan Invariant

### 2.1 MVP

1. **Katalog terpusat:** otorisasi beberapa toko melalui Shopee Open Platform; sinkronisasi base product dan variant; pencarian/filter shop, status, category, SKU, stock state, dan sync state; freshness dan error aman yang actionable.
2. **Analitik produk:** hanya metrik yang benar-benar diberikan kepada app oleh endpoint resmi; kandidat awal adalah 30-day views, cumulative sales, likes, ratings, dan star rating. Semua nilai memiliki definisi, window, waktu observasi, status coverage, dan freshness.
3. **Salin produk lintas toko:** satu source ke beberapa destination; destination requirements dibaca dan divalidasi lokal; preview editable per destination; Owner/Admin mengonfirmasi secara eksplisit; baru setelah itu worker boleh melakukan mutation ke MediaSpace/product; setiap destination terisolasi dan idempotent.

### 2.2 Non-goals

Orders/fulfillment, chat, ads/promotion/voucher, accounting/reconciliation, warehouse/marketplace lain, real-time inventory sync, general bulk editing, AI content, autonomous listing changes, native mobile, public SaaS, billing, dan multi-company tenancy. Copy membuat listing baru; tidak membuat hubungan sinkronisasi lanjutan.

### 2.3 Reserved user decisions

User tetap memutuskan scope expansion, biaya eksternal signifikan, penggunaan credential nyata, production deployment, perubahan invariant agar listing incomplete boleh public, dan destructive cleanup/removal.

### 2.4 Invariant wajib

- Hanya official Shopee Open Platform; tidak ada cookie/browser automation fallback.
- Partner key, token, callback code, OAuth state secret, authorization header, dan raw credential tetap server-only dan tidak masuk client/log/trace/metric/audit/job payload.
- Shop ownership, authorization grant, credential subject, active membership, feature flag, command hash, dan supported product shape diverifikasi server-side.
- **Tidak ada mutation Shopee sebelum explicit confirmation, termasuk tidak ada MediaSpace upload.**
- Invalid/unsafe destination tetap unpublished dan tidak di-dispatch.
- Setiap destination memiliki state/job/attempt sendiri; kegagalan satu toko tidak memblokir toko lain.
- Call yang mungkin telah mencapai Shopee tidak di-retry secara blind; `OUTCOME_UNKNOWN` adalah state first-class.
- Analytics tidak mengarang metric/history dan membedakan zero, missing, unsupported, not returned, dan stale.

## 3. RALPLAN-DR

### Principles

1. Official and least privilege.
2. Subject-correct ownership dan credential isolation.
3. No unreviewed upstream mutation.
4. Durable ambiguity untuk at-least-once, crash, revocation, dan external outcome.
5. Truthful product support dan analytics coverage.

### Top decision drivers

1. Keamanan/correctness credential rotation dan externally visible writes.
2. Kecepatan delivery serta operational simplicity untuk internal MVP.
3. Failure isolation, replay safety, auditability, dan evidence-based verification.

### Opsi

#### A. TypeScript modular monolith, separate runtime identities, PostgreSQL jobs — dipilih

Pro: contract/transaction sederhana, no pilot broker split-brain, web/worker privilege boundary kuat, dapat diekstrak kemudian. Kontra: queue load berbagi database dan package/DB boundaries harus ditegakkan.

#### B. Modular monolith dengan Redis/broker

Pro: retry/delay tooling dan queue throughput lebih independen. Kontra: komponen durability tambahan dan duplicate enqueue boundary tanpa capacity evidence.

#### C. Dedicated Shopee integration service

Pro: credential/blast-radius isolation terkuat. Kontra: distributed authorization, deployment, contract, dan transaction overhead terlalu dini untuk MVP.

#### D. Synchronous web plus cron

Pro: footprint kecil. Kontra: tidak aman untuk media/item/variation, partial success, leases, ambiguous outcomes; ditolak untuk write MVP.

### Keputusan

Gunakan Option A. PostgreSQL adalah source of truth untuk domain, outbox, queue job, schedule slot, external attempt, dan acknowledgement. Gunakan broker hanya jika measured DB/queue SLO menunjukkan kebutuhan setelah indexing, batching, retention, dan worker tuning. Ekstrak service bila team split, write volume independen, marketplace bertambah, atau compliance menuntut isolation.

## 4. Stack dan Struktur Target

Pilih stable/LTS yang didukung saat bootstrap; exact version dicatat di lockfile, bukan di-hard-pin dalam rencana.

- TypeScript dan supported Node.js LTS.
- Next.js App Router/React untuk authenticated web/BFF.
- Auth.js-compatible OIDC; identity key `(oidc_issuer, oidc_subject)`.
- PostgreSQL dengan typed SQL/ORM, explicit constraints, dan migrations.
- Shared runtime validation seperti Zod pada config, HTTP, command, job, dan adapter boundary.
- PostgreSQL-backed outbox/job/scheduler untuk pilot.
- Managed KMS/secret manager dengan envelope encryption.
- OpenTelemetry-compatible telemetry dan allowlist JSON logging.
- Unit, PostgreSQL integration, Shopee contract stub, dan browser E2E testing.

```text
apps/web/app/(authenticated)/{catalog,analytics,copy,settings/shops}/
apps/web/app/api/auth/shopee/{start,callback}/route.ts
apps/worker/src/{dispatcher,scheduler,index}.ts
apps/worker/src/jobs/{oauth-exchange,token-refresh,catalog-sync,metric-collection,copy-destination}.job.ts
packages/auth/src/{session,authorize,command-authorization}.ts
packages/config/src/env.ts
packages/db/src/{schema,migrations,roles,views}/
packages/domain/src/{catalog,analytics,copy,rbac}/
packages/shopee/src/{client,oauth,products,media,rate-limit}/
packages/queue/src/{outbox,jobs,leases,scheduler,dead-letter}.ts
packages/observability/src/{logger,redaction,tracing,metrics,audit}.ts
tests/{unit,integration,contract/shopee,e2e,observability}/
```

CI menegakkan dependency direction. UI tidak mengimpor database/Shopee client; domain tidak bergantung pada adapter implementation.

## 5. Runtime, Database, Secret, dan Token-Exchange Authority

### 5.1 Service identities

| Identity | Boleh | Dilarang |
| --- | --- | --- |
| `web` | Auth user, safe projections, OAuth state, local previews, confirmation, immutable commands/outbox; KMS `Encrypt` hanya untuk callback-code envelope dengan encryption context khusus | Membaca token ciphertext, KMS decrypt, membaca partner key, memanggil Shopee mutation/exchange/refresh, mengubah publication result |
| `shopee-worker` | Menjalankan token exchange/refresh dan semua Shopee calls; membaca partner-key secret; KMS `Decrypt/Encrypt` hanya untuk callback-code/token context; membaca confirmed commands; update external attempts/sync/publication | Membership management, membuat/mengubah confirmation, browser session, cross-org/shop execution |
| `migration` | DDL dan grants pada controlled deployment | Tersedia di runtime container |
| `readonly-support` | Secret-free views dengan organisasi/resource restrictions | Ciphertext, OAuth state/code, sensitive command fields, semua mutation |

Network identity, DB credential, service account, secret set, dan KMS policy dipisahkan. Actual database grants dan KMS-denial tests menjadi release gate.

### 5.2 Token-exchange executor — clarification gate

`shopee-worker` adalah satu-satunya token-exchange executor. Callback web:

1. memvalidasi dan mengklaim OAuth state;
2. mengenkripsi callback code dengan KMS `Encrypt` memakai context `oauth-callback-code`;
3. menulis immutable exchange command + outbox;
4. tidak membaca partner key dan tidak melakukan exchange.

Worker membaca partner key melalui secret-manager permission yang dibatasi pada partner app/environment terkait, mendekripsi callback code, menandatangani/call exchange, lalu mengenkripsi token dengan context organization/partner-app/credential-subject. Callback-code ciphertext memiliki TTL pendek dan dihapus hanya melalui approved retention setelah definitive resolution.

Jika current official authorization-start URL membutuhkan partner-key signing, capability gate harus memilih salah satu pola teruji sebelum Phase 2: worker menghasilkan short-lived signed URL melalui request/result job, atau restricted signing service/KMS-HMAC yang tidak mengekspos key. Web tetap tidak memperoleh raw partner key. Jika signing tidak diperlukan, jangan menambah mekanisme tersebut.

## 6. Data Model dan Ownership

Semua resource bisnis memiliki `organization_id`; external shop/item identifiers juga di-scope oleh `partner_application_id` dan market sampai global uniqueness terbukti.

| Entity | Kontrak inti |
| --- | --- |
| `organizations`, `users`, `memberships` | User key issuer+subject; membership Owner/Admin/Staff dengan active/revoked dan authz revision. |
| `partner_applications` | Environment/market, partner identifier reference, callback config, status; tanpa secret value. |
| `oauth_attempts` | Actor/org/app, state hash, redirect binding, status, code fingerprint/ciphertext reference, expiry. |
| `authorization_grants` | Shop/main-account grant subject, app/org, authorization status/expiry. |
| `credential_subjects` | Actual refresh-token lineage, encrypted token, expiry, key version, token revision/status. |
| `shop_connections` | Org/app/market/external shop ID, safe metadata/status/freshness; tidak menyimpan token. |
| `grant_shop_connections` | Membuktikan grant mencakup shop. |
| `shop_credential_bindings` | Menentukan credential subject yang berlaku untuk shop sesuai exchange evidence. |
| `products`, `product_variants` | Scoped external IDs, safe product fields, upstream timestamps dan sync status. |
| `sync_runs`, `sync_errors` | Pagination/window/completeness/counts dan safe errors. |
| `metric_definitions` | Capability version, semantic kind, unit/window, aggregation/delta rules. |
| `analytics_collection_runs` | Window, capability, pages/items expected/observed, cursor, as-of range/tolerance, COMPLETE/PARTIAL/FAILED. |
| `product_metric_snapshots` | Run/definition/product dengan `VALUE/MISSING/UNSUPPORTED/NOT_RETURNED`; zero adalah `VALUE=0`. |
| `copy_batches` | Source selection dan batch owner/status. |
| `copy_intents` | Stable logical intent per batch+destination; `active_command_version`, serialization generation, terminal published mapping. |
| `copy_source_snapshots`, `destination_requirement_snapshots` | Immutable allowlisted data, completeness/freshness/capability/hash. |
| `copy_previews` | Immutable editable revision, validation result/errors, preview hash. |
| `copy_confirmations` | Actor/authz/policy/feature version, selected preview hashes/time. |
| `copy_destination_commands` | Immutable version under stable intent; source/requirement/preview/confirmation hashes. |
| `copy_destination_jobs` | Active command job state, queue/lease references, safe error/upstream ID. |
| `external_operation_attempts` | Operation, intent/command/job, credential subject, attempt UUID, request fingerprint, PREPARED/STARTED/DEFINITELY_FAILED/SUCCEEDED/OUTCOME_UNKNOWN, safe correlation/resource ID. |
| `published_item_mappings` | Intent/destination/upstream item ID, item/variation status; unique logical intent and scoped item. |
| `outbox_events` | Immutable UUID/type/version/command reference, created/dispatched time. |
| `queue_jobs` | Unique outbox event/job UUID, availability, lease owner/expiry/generation, attempt/ack. |
| `scheduled_triggers` | Unique task+target+time bucket. |
| `dead_letter_jobs`, `audit_events`, `pilot_workflow_measurements` | Replay evidence, secret-free append-only audit, comparable pilot measurement. |

Composite constraints prevent cross-org references. Confirmation, command, attempt history, audit, dan published mapping bersifat immutable kecuali explicit state transitions.

## 7. OAuth, Credential Subject, dan Rotation

### 7.1 Model authority

Setiap call membuktikan secara terpisah:

1. organization owns shop;
2. active authorization grant covers shop;
3. active shop binding memilih credential subject yang berwenang;
4. partner app dan market cocok.

Jangan pernah memilih “first token-bearing shop.” Satu main-account grant dapat mencakup banyak shop; actual response menentukan apakah credential subject shared atau independent.

### 7.2 Exchange

- Web claim state `EXCHANGING`, persist encrypted code dan external attempt `PREPARED`, lalu outbox command.
- Worker transition attempt ke `STARTED` sebelum call.
- Persist grant, shop list, credential subjects, bindings, ciphertext, dan attempt success sebelum hasil aman ditampilkan.
- Duplicate callback membaca hasil durable. Jika exchange outcome unknown dan code replay safety tidak terbukti, minta authorization baru; tidak blind exchange.

### 7.3 Refresh

- Lock scope adalah `credential_subject_id`, bukan shop.
- Persist PREPARED; row/advisory lock subject; re-read revision; STARTED; refresh sekali; atomically replace access/refresh ciphertext dan increment revision.
- Semua bound shops memakai winning revision.
- Definite revoked/invalid menandai subject/bound connections `REAUTH_REQUIRED`.
- Crash/DB failure setelah Shopee mungkin merotasi token menghasilkan `OUTCOME_UNKNOWN`; tanpa official safe recovery, subject menjadi `REAUTH_REQUIRED`, bukan retry stale token.

## 8. PostgreSQL At-Least-Once Delivery

Terminologi authoritative:

- **Outbox rows tidak memakai lease.** Dispatcher memilih batch singkat dengan PostgreSQL row lock `FOR UPDATE SKIP LOCKED`; dalam transaction yang sama ia insert `queue_jobs` dengan unique `outbox_event_id` dan menandai outbox `dispatched_at`. Rollback melepaskan row lock dan tidak meninggalkan partial enqueue.
- **Queue jobs memakai lease dan fencing generation.** Worker claim atomically menetapkan `lease_owner`, `lease_expires_at`, dan increment generation. Hanya holder generation aktif boleh commit.
- **Scheduled trigger materialization memakai row/advisory lock plus unique slot**, bukan queue lease.

Semantics adalah at-least-once dengan idempotent transitions:

1. Domain command + audit + outbox ditulis satu transaction.
2. Duplicate outbox scan menjadi no-op melalui unique event/job constraint.
3. Worker commits external-attempt result + domain/job transition + published mapping + audit sebelum queue acknowledgement.
4. Crash setelah commit sebelum ack menyebabkan redelivery yang melihat terminal state dan tidak mengulang mutation.
5. Expired job lease dapat direclaim; stale generation tidak boleh commit.
6. Hanya definite transient failure yang retry dengan capped exponential backoff/jitter/`Retry-After`.
7. Poison/version/invariant failure masuk dead letter. Owner/Admin replay membuat queue job baru yang mereferensikan immutable command/original DLQ; tidak mengubah payload atau melewati authorization.
8. Evidence unresolved tidak dihapus oleh retention.

Broker migration mempertahankan event IDs, at-least-once, DB idempotency, dan external attempts; dilakukan hanya berdasarkan capacity evidence.

## 9. Hierarchical Rate-Limit Contract — clarification gate

Capability matrix mencatat setiap discovered limit beserta scope, window, burst, header/error evidence, market, endpoint, dan tanggal. Limiter menerapkan seluruh scope yang terdokumentasi:

1. partner application/global;
2. credential subject;
3. shop;
4. endpoint atau endpoint group.

Satu request harus memperoleh capacity dari semua applicable buckets; bucket paling ketat menentukan waktu eksekusi. Bila scope belum diketahui, gunakan conservative partner/global plus shop limit dan batasi concurrency sampai staging evidence tersedia. `429`/throttle response memperbarui bucket yang dibuktikan oleh official header/code; jika response tidak mengungkap scope, penalize conservative partner/global bucket agar tidak menekan API. Scheduler, manual sync, refresh, analytics, media, dan copy menggunakan registry/limiter yang sama. Refresh/emergency reauth memiliki reserved concurrency hanya jika official limits mengizinkan; jangan mengarang priority exemption.

Metrics: wait per scope, throttle per endpoint/scope, bucket exhaustion, retry-after, concurrency, oldest job. High-cardinality subject/shop IDs masuk log/trace, bukan metric labels.

## 10. Async RBAC dan Revocation

| Action | Owner | Admin | Staff |
| --- | --- | --- | --- |
| Read catalog/analytics/safe status | Ya | Ya | Ya |
| Create/edit/validate preview | Ya | Ya | Ya |
| Confirm/publish | Ya | Ya | Tidak |
| Manual sync | Ya | Ya | Tidak |
| Authorize/reauthorize/disconnect shops | Ya | Tidak | Tidak |
| Manage membership/role/settings | Ya | Tidak | Tidak |
| Full audit/export | Ya | Read-only safe | Tidak |

Sebelum dispatch worker revalidasi active actor membership, Admin/Owner publication permission, org/resource/shop ownership, connection/grant/subject/binding, confirmation/command/source/requirement/preview hashes, feature flag/policy version, supported shape, current logical intent version, dan absence of terminal/unresolved attempt.

Jika gagal sebelum first external mutation STARTED, gunakan exact non-mutating state: `AUTHORIZATION_REVOKED`, `SHOP_DISCONNECTED`, `COMMAND_STALE`, `FEATURE_DISABLED`, atau `UNSUPPORTED_SHAPE`.

Setelah MediaSpace success tetapi sebelum add-item, revocation memblokir add-item; staged media hanya mengikuti official safe expiry/cleanup policy. Setelah add-item mungkin terkirim, revocation tidak dapat “membatalkan” history: job masuk `OUTCOME_UNKNOWN`, `PARTIAL_CREATED`, atau definite result. Recovery hanya read/reconcile/approved containment dan tidak boleh memulai create baru dengan revoked authority.

## 11. Catalog dan Analytics Semantics

### Catalog

- Per-shop paginated sync untuk list/base/model/approved extra info.
- Scoped upsert dan upstream cursor/marker bila reliable.
- Tidak menandai deleted/missing sampai complete authoritative scan atau explicit status.
- Expected/observed pages/items dan completeness disimpan.
- Limiter berlaku pada partner, credential subject, shop, endpoint scopes.

### Analytics collection

Setiap snapshot terkait `analytics_collection_run` yang menyimpan requested window, capability version, start/end, as-of min/max, expected/observed items/pages, cursor/completion evidence, tolerance, dan COMPLETE/PARTIAL/FAILED.

- `VALUE=0`: upstream explicit zero.
- `MISSING`: item sukses tetapi supported field absent/null.
- `UNSUPPORTED`: app/market capability tidak menyediakan metric.
- `NOT_RETURNED`: page/item tidak tercakup karena run incomplete.
- `STALE`: last valid observation melampaui tolerance.

Aggregate/comparison hanya bila metric/window/capability kompatibel, coverage complete, dan as-of range dalam tolerance. Rolling 30-day views tidak dijumlahkan. Cumulative delta hanya pada ordered valid observations dengan reset/decrease handling. Rating/star tidak additive. History dimulai saat first complete collection; tidak mengklaim backfill.

## 12. Copy Intent, Preview, Serialization, dan Publication

### 12.1 Stable logical intent — clarification gate

`copy_intent_id` adalah stable identity untuk satu batch-source-snapshot + destination shop. Command revisions tidak membuat logical copy baru.

- Setiap intent memiliki monotonically increasing `command_version`, `active_command_id`, dan `serialization_generation`.
- Hanya satu nonterminal active command/job per intent melalui unique partial constraint.
- Membuat superseding command wajib mengambil row lock pada intent. Supersede hanya boleh bila command lama belum memiliki external operation `STARTED` dan belum mempunyai staged mutation/upstream item ID.
- Dalam transaction yang sama: command lama -> `SUPERSEDED`, preview/confirmation revision baru disimpan, active command/version/generation diganti, dan outbox baru dibuat.
- Dispatcher/worker lock intent dan memverifikasi command ID/version/generation sebelum dispatch/commit. Stale job menjadi `COMMAND_STALE` tanpa external call.
- Jika external attempt STARTED/SUCCEEDED/OUTCOME_UNKNOWN/PARTIAL_CREATED, superseding dilarang sampai outcome resolved. Editing membuat correction plan untuk intent yang sama, bukan parallel create.
- Setelah published mapping sukses, intent terminal. Menginginkan listing tambahan memerlukan explicit new user-created copy intent, bukan version retry.

### 12.2 State machine

```text
DRAFT -> REQUIREMENTS_LOADING -> NEEDS_INPUT | INVALID | VALIDATED
VALIDATED -> CONFIRMED -> QUEUED -> AUTHORIZATION_CHECK
-> MEDIA_UPLOADING -> ITEM_CREATING -> VARIATION_INITIALIZING -> SUCCEEDED

Pre-send/hold:
AUTHORIZATION_REVOKED | SHOP_DISCONNECTED | COMMAND_STALE |
FEATURE_DISABLED | UNSUPPORTED_SHAPE | TERMINAL_FAILED | SUPERSEDED

Recovery:
RETRYABLE_FAILED | REAUTH_REQUIRED | REQUIREMENTS_STALE |
OUTCOME_UNKNOWN | PARTIAL_CREATED
```

### 12.3 Preview: zero mutation

Capture immutable source snapshot. Lakukan read-only fetch destination leaf category, mandatory attributes, brands, limits, logistics, shipping, dan media requirements. Validasi media metadata secara lokal; jangan upload. Map explicit fields, simpan requirement completeness/freshness dan immutable preview hash. Edit membuat revision/hash baru. Confirmation mengikat selected valid destinations dan exact hashes.

### 12.4 Confirmed execution

1. Revalidate async authorization, logical intent version, dan supported shape.
2. Persist MediaSpace external attempt PREPARED/STARTED; upload sebagai first mutation.
3. Revalidate revocation sebelum add-item.
4. Persist add-item attempt PREPARED/STARTED; send sekali.
5. Pada success, atomically simpan upstream item ID/published mapping sebelum variation.
6. Init variation hanya untuk verified safe shape.
7. Persist definite result/audit; resume hanya dari definitely incomplete safe step.

### 12.5 Outcome unknown

Setiap mutation memiliki durable attempt UUID dan request fingerprint. Jika timeout, lost response, worker death after send, atau DB commit failure sebelum resource ID durable, state menjadi `OUTCOME_UNKNOWN`. Resolution hanya melalui durable upstream ID, official idempotency/correlation lookup, documented unique search/proof of absence, atau audited Owner decision. Normal retry tidak boleh resend saat unresolved.

### 12.6 Supported shape

Capability matrix menilai simple item, variant tiers, media, draft/hidden, visibility timing, variation atomicity, safe disable/repair, dan lookup. Shape hanya enabled bila confirmed flow menghasilkan listing complete atau intermediate public state memiliki documented/tested containment guarantee. Bila add-item public sebelum required variation dan tidak ada safe guarantee, shape tersebut tetap `UNSUPPORTED_SHAPE`.

## 13. Security, Audit, dan Observability

- Threat model: OAuth replay/substitution, credential-subject confusion, IDOR, SSRF/media, XSS, CSRF, queue tampering, stale command, secret leakage, privilege escalation.
- Outbound Shopee hosts allowlisted; media redirects/content type/size/private-network access dibatasi.
- Secure HTTP-only same-site session, CSRF defense, CSP/headers, recent auth untuk shop/membership changes.
- Audit: grant/binding/token result, sync/collection, preview/confirmation/supersede, dispatch denial, external attempt/recovery/publication, roles/connections/feature flags, DLQ replay. Hanya safe IDs/hashes/codes.
- Metrics: OAuth/refresh, outbox row-lock processing, queue lease/fencing/retry/DLQ, scheduler conflicts, limiter by bounded scope type, copy attempt/outcome, analytics coverage, DB/KMS authorization denials.
- `pre_confirmation_shopee_mutation_total` harus selalu zero; test failure/blocking alert bila nonzero.
- Correlation: request -> confirmation -> intent/command -> outbox -> queue lease -> attempt -> result/audit.

## 14. Implementation Phases dan Gates

### Phase 0 — requirement baseline

Artifacts: final plan, PRD, acceptance matrix, initial capability matrix/unknown register, pilot baseline method.

Owner: product/technical lead; Shopee evidence by integration lead; tests by test lead.

Exit: traceability reviewed; external unknowns memiliki owner dan blocking phase; execution tetap menunggu host receipt.

### Phase 1 — foundation dan privilege separation

Build target: workspace, OIDC/org/RBAC, migrations, distinct DB roles/service identities, config, safe telemetry, audit, PostgreSQL outbox/job/scheduler primitives.

Gate: web/worker/migration/readonly allow-deny tests; package boundaries; duplicate/crash queue prototype; production config fail closed.

### Phase 2 — OAuth grant/credential subject

Build target: state/callback command, `shopee-worker` exchange executor, partner-key/KMS policies, grants/subjects/shop bindings, subject-scoped refresh/recovery.

Gate: authorization-start signing requirement verified; shop/main-account/shared/independent subjects; duplicate exchange; rotation crash; rate-limit scope discovery for auth/refresh.

### Phase 3 — catalog dan collection foundation

Build target: product/variant sync, pagination/completeness, catalog UI/filter/freshness, limiter registry.

Gate: product fields/pagination/rates capability evidence; incomplete sync tidak mengklaim deletion/completeness.

### Phase 4 — analytics

Build target: metric definitions, collection runs/snapshots, comparison eligibility, analytics UI.

Gate: supported fields/windows/capability/as-of behavior; zero/absence/coverage tests.

### Phase 5 — local copy preview only

Build target: source/requirements/previews, stable copy intent, command supersede serialization, mapper/validator/hash, UI. Tidak ada mutating adapter enabled.

Gate: ten independent previews; invalid/unsafe blocked; zero upstream mutation; stale jobs rejected by intent version/generation.

### Pre-write gate

Wajib confirm: MediaSpace ordering/reuse/cleanup; add-item response/correlation; draft/hidden/visibility; variation atomicity; safe disable/repair; supported shapes; applicable rate-limit scopes. Recovery/runbooks dan crash/revocation/supersede tests harus lulus. Product, architecture, security, test/verifier, dan Shopee lead approve.

### Phase 6 — confirmed write

Build target: MediaSpace/add-item/variation adapters, attempts, publication/recovery worker/UI.

Gate: 7-valid/3-invalid pressure test, every crash boundary, no duplicate create, unknown not auto-retried, only supported shapes.

### Phase 7 — staging, alpha, pilot

Gate: full security/test, backup/restore/rollback, runbook exercises, approved credential/cost/deployment, read-only reconciliation, gradual write feature flag, baseline freeze.

## 15. Acceptance Criteria

1. Official authorization dapat menyimpan grant, actual credential subject(s), shop mappings/bindings, dan distinct shop connections.
2. `shopee-worker` saja yang dapat membaca partner key dan KMS-decrypt token/code; web/readonly tidak dapat.
3. Shared credential subjects serialize refresh; independent subjects dapat refresh independen.
4. Crash setelah possible token rotation menghasilkan unknown/reauth, bukan stale retry.
5. Duplicate callback/exchange menghasilkan satu durable mapping atau explicit unknown/restart.
6. Canary secrets tidak muncul pada client, safe views, queue payload, log, trace, metric, audit, atau error sink.
7. Catalog enam filter dan detail/variant ownership benar; forged IDs ditolak.
8. Analytics membedakan zero/missing/unsupported/not-returned/stale dan menampilkan window/as-of/completeness.
9. Partial/incompatible collection tidak menghasilkan aggregate/comparison claim.
10. Sepuluh destination menghasilkan sepuluh preview; tiga invalid/unsafe tidak confirmable; tujuh valid dapat dipilih.
11. Sebelum confirmation, total MediaSpace/product/status/variation/cleanup mutation adalah zero.
12. Confirmation hanya Owner/Admin aktif dan mengikat exact hashes/policy/authz/feature versions.
13. Copy intent men-serialize command revisions; stale/superseded job tidak call Shopee.
14. Supersede ditolak bila mutation attempt telah STARTED atau outcome unresolved.
15. Revocation/disconnect/stale requirement/feature disable sebelum first mutation menghasilkan exact non-mutating state.
16. Setelah possible send, revocation menghasilkan recovery, bukan cancel/resend.
17. Setiap mutation memiliki committed attempt sebelum send.
18. Worker death pada semua network/DB/ack boundaries tidak menyebabkan automatic second add-item.
19. `OUTCOME_UNKNOWN` terlihat, retry-blocking, evidence-preserving, dan hanya resolved melalui approved evidence/operator flow.
20. Unsafe variant/visibility shape tidak dapat di-confirm atau dispatch.
21. Duplicate outbox scan/job delivery, stale lease, lost ack, DLQ replay, dan schedule collision tetap satu logical command/listing.
22. Limiter menerapkan semua discovered partner/global, credential-subject, shop, dan endpoint scopes; unknown scope conservative.
23. Database/KMS/service identity allow-deny tests lulus.
24. Semua lifecycle sensitif menghasilkan correlated secret-free audit.
25. Shopee outage mempertahankan local read dengan stale state dan bounded queue backoff.
26. Core flow accessible/responsive pada desktop/tablet/mobile browser.
27. Pilot report menggunakan frozen comparable workflow/shop/item/time method dan menyatakan pass/fail target minimal 50%.

## 16. Test Plan

### Unit

RBAC/ownership/authz revision; OIDC identity; OAuth state; grant/subject/binding resolver; token lock/revision; encryption context; copy intent version/supersede rules; outbox row-lock vs job lease/fencing; scheduler unique slot; hierarchical limiter; metric value/coverage semantics; preview/confirmation hashes; state machine; external outcome classifier; redaction.

### Integration dan crash matrix

- Actual PostgreSQL grants untuk semua identities.
- Callback: shop/main-account/shared/per-shop subjects, duplicate, timeout, response-before-DB-failure.
- Refresh: concurrent shared/independent, invalid, timeout, rotation then crash/commit failure.
- Outbox: before domain commit, after commit, dispatcher rollback/duplicate/unique conflict; verifikasi outbox row locks tanpa lease.
- Queue jobs: claim, lease expiration, fencing rejection, duplicate delivery, poison/DLQ/replay, commit-before-ack.
- Scheduler: concurrent slot, overlap manual/scheduled, bounded backfill.
- Copy intent: concurrent preview confirmation, two superseding revisions, stale dispatch, STARTED-attempt supersede denial.
- Media/add-item/variation: fail, timeout, death before send/during send/after response/before result commit/after commit-before-ack.
- Zero mutating calls untuk semua pre-confirm/invalid/stale/revoked paths.
- Analytics: missing/duplicate page, cursor loop, expected mismatch, incompatible capability/as-of/window.
- Limiter: simultaneous requests consume all applicable buckets; ambiguous 429 backs off conservatively.
- Secret scan pada safe views/job/log/trace/audit/error sinks.

### E2E

Owner multi-shop OAuth; Staff/Admin/Owner policy plus forged requests; catalog filters; analytics absence/coverage; 10-shop 7/3 scenario; edit/supersede/reconfirm; role/shop revocation before and after mutation; double-click/replay/worker restart/lost ack; unknown recovery UI; unsupported shape denial; outage degradation; accessibility/responsive; pilot capture/report.

### Observability

Correlation chain; OAuth/rotation unknown alerts; outbox age; job lease/fencing; DLQ; rate-limit scopes; outcome/partial age; incomplete analytics; pre-confirm mutation; DB/KMS denial; no secrets/high-cardinality metric labels. Load test menentukan apakah PostgreSQL queue memenuhi SLO atau broker ADR perlu dibuka.

## 17. Rollout, Rollback, dan Stop Rules

1. Local/CI: Shopee stub, isolated PostgreSQL, deterministic clock, secret canaries.
2. Approved staging: verify capability matrix, credential subjects, rotation, limit scopes, pagination, media/item/variation, visibility, recovery.
3. Read-only alpha: Owner + satu operator; reconcile catalog/analytics dengan Seller Centre.
4. Write pilot: feature flag, satu supported simple shape dan satu destination dahulu; expand setelah recovery drills.
5. 30-day pilot: frozen baseline, weekly operational review, final comparable report.

Rollback memblokir confirmation/dispatch baru, menahan pre-send jobs, mempertahankan read/audit/recovery, dan tidak menghapus evidence. Attempt yang mungkin mencapai Shopee tidak boleh ditandai cancelled.

Stop/go-production bila: no critical security/test gap, all enabled capabilities confirmed, unknown outcome/runbook exercised, backup/restore/rollback proven, rate limits bounded, supported shapes explicit, dan user menyetujui credential/cost/deployment.

## 18. Pre-Mortem dan Risks

### 1. Shared credential lineage dianggap per-shop

Signal: clustered 401/invalid refresh. Prevention: grant/subject/binding + subject lock. Recovery: pause all bound shops, reauth, safe replay.

### 2. Ambiguous add-item dan redelivery membuat duplicate

Signal: multiple upstream IDs/unknown attempts. Prevention: durable attempt, copy intent serialization, published mapping, fencing, no blind retry. Recovery: disable dispatch dan evidence-based reconcile.

### 3. Queue/rate/coverage semantics memberi false confidence

Signal: duplicate schedule, DB queue contention, throttle storm, analytics berubah saat page hilang. Prevention: row-lock outbox, leased jobs, hierarchical limits, complete collection gates. Recovery: halt affected scheduler/aggregate, safe replay/recollect, label incomplete.

| Risk | Mitigation |
| --- | --- |
| Credential scope berbeda | Persist actual subject/binding; capability/staging gate. |
| Refresh rotated but not persisted | Attempt unknown -> reauth absent official recovery. |
| Public incomplete listing | Supported-shape gate; exclude unsafe. |
| External timeout | `OUTCOME_UNKNOWN`; no blind retry. |
| Superseding race | Intent row lock/version/generation/unique active command. |
| Revoked actor | Recheck before dispatch; recovery after possible send. |
| Unknown limit scope | Conservative global+shop and capability TODO. |
| PostgreSQL queue load | Metrics/tuning; broker only on evidence. |
| Incomplete analytics | Run completeness/as-of/capability gates. |
| Secret/IDOR | Service/DB/KMS separation, redaction, composite ownership tests. |
| Scope creep/biased pilot | Non-goals/change control; frozen comparable baseline. |

## 19. External Capability Gates yang Belum Terselesaikan

Semua item berikut berstatus `TODO/UNKNOWN` sampai diverifikasi pada current official docs dan partner app Console, dengan tanggal, market, environment, evidence, owner, serta blocking phase:

1. Exact partner-app permissions untuk authorization, product reads, extra metrics, categories/attributes/brand/limits/logistics, MediaSpace, add-item, variation, status/repair.
2. Authorization-start signing requirement dan pola aman yang didukung.
3. Callback/exchange credential subject: shared main account/merchant versus per-shop lineage.
4. Code exchange replay/idempotency dan recovery setelah timeout/crash.
5. Access/refresh expiry dan refresh rotation/recovery behavior aktual.
6. Rate-limit scope/window/burst/header/error pada partner/global, credential subject, shop, dan endpoint untuk setiap enabled market.
7. Pagination counts/cursors/completeness semantics untuk catalog dan metrics.
8. Metric fields/definitions/windows/absence behavior per app/market.
9. Leaf-category/mandatory attribute/brand/item/logistics/shipping/media constraints per market.
10. MediaSpace preconditions, handle lifetime/reuse, orphan expiry/cleanup yang non-destructive.
11. `add_item` response IDs, official correlation/idempotency atau unique lookup untuk ambiguous outcome.
12. Draft/hidden/default visibility behavior dan waktu listing menjadi public.
13. Variation initialization ordering/atomicity serta safe disable/repair/cleanup.
14. Supported product-shape matrix untuk simple dan variant items.
15. Exact regional endpoint hosts/signature/canonical-request behavior.

Official reference links:

- Platform introduction: https://open.shopee.com/developer-guide/4
- Authorization: https://open.shopee.com/developer-guide/20
- Product preparation: https://open.shopee.com/developer-guide/209
- Product creation: https://open.shopee.com/developer-guide/211
- Product information: https://open.shopee.com/developer-guide/221

## 20. ADR-001

### Decision

TypeScript modular monolith dengan separate web/worker runtime identities dan DB roles, PostgreSQL source of truth, transaction outbox, PostgreSQL queue/scheduler, immutable commands, stable copy intents, credential-subject rotation, hierarchical rate limiter, durable external attempts, dan at-least-once idempotent execution.

### Alternatives dan rationale

Redis/broker ditunda sampai capacity evidence; dedicated integration service ditunda sampai scaling/team/compliance trigger; synchronous/cron ditolak untuk write safety.

### Consequences

Positive: fewer distributed components, atomic outbox/job creation, auditable crash recovery, strong privileges. Negative: DB queue load/index/retention discipline dan human recovery untuk sebagian ambiguous outcome. Tidak ada architecture yang memberi exactly-once Shopee write; idempotency/reconciliation tetap invariant.

### Follow-up ADR gates

Credential-subject mapping, supported listing shapes, authorization-start signing, dan broker migration hanya setelah official/capacity evidence.

## 21. Planning Document Inventory dan Owners

| Artifact | Owner | Gate |
| --- | --- | --- |
| `README.md` | Writer/Product | Concise index, materialized package. |
| `docs/requirements/PRD.md` | Product | Phase 0. |
| `docs/requirements/acceptance-criteria.md` | Test/Product | Phase 0. |
| `docs/requirements/shopee-capability-matrix.md` | Shopee lead | Initial Phase 0; relevant rows complete per phase/pre-write. |
| `docs/requirements/credential-subject-model.md` | Shopee/Security | Phase 2 exit. |
| `docs/requirements/analytics-semantics.md` | Analytics/Product | Phase 4 exit. |
| `docs/requirements/copy-product-state-machine.md` | Domain/Security | Phase 5/pre-write. |
| `docs/requirements/rbac-matrix.md` | Product/Security | Phase 1/5. |
| `docs/architecture/ADR-001-modular-monolith.md` | Architecture | Phase 1. |
| `docs/architecture/data-model.md` | Domain/Architecture | Phase 1/2. |
| `docs/architecture/integration-contracts.md` | Domain/Shopee | Per adapter phase. |
| `docs/security/threat-model.md` | Security | Initial Phase 1; final pre-production. |
| `docs/security/secret-handling.md` | Security | Phase 2. |
| `docs/testing/test-strategy.md` | Test/Verifier | Phase 1, updated each phase. |
| `docs/operations/pilot-measurement.md` | Product/Ops | Baseline before adoption; final pre-pilot. |
| `docs/operations/external-outcome-recovery.md` | Domain/Ops | Pre-write. |
| `docs/operations/runbooks.md` | Ops | Pre-write sections; full pre-production. |
| `docs/operations/rollback.md` | Ops/Architecture | Pre-production. |
| `docs/roadmap.md` | Product/Technical Lead | Phase sequencing and gates. |

## 22. Staffing dan Future Handoff

Relevant roles: `explore`, `researcher`, `dependency-expert`, `architect`, `critic`, `executor`, `test-engineer`, `debugger`, `verifier`, `code-reviewer`, `designer`, `writer`, `git-master`, `code-simplifier`.

Setelah official receipt, gunakan `$ultragoal` sebagai durable phase/exit ledger dan `$team` untuk lane terpisah:

1. Leader/architect high/xhigh: phases, schemas/contracts, integration, final verification.
2. Shopee/security executor high: capability, token exchange/refresh, secrets, external attempts/limits.
3. Domain/data executor high: PostgreSQL delivery, catalog, analytics completeness, copy intent/state.
4. Web/designer medium/high: role-correct accessible UI.
5. Test engineer high: DB grants, contract stub, concurrency/crash/E2E/observability.
6. Independent verifier/reviewer high: security/invariant/evidence gate.

Assign non-overlapping packages/migrations. Sequence foundation -> credentials -> reads -> analytics/preview -> pre-write -> writes -> pilot. `$ralph` hanya narrow fallback; `$autoresearch-goal` untuk unresolved capability research; `$performance-goal` untuk measured queue/query optimization.

## 23. Final Verification Checklist

- [x] Scope, non-goals, roles, reserved decisions, dan 50%/30-day outcome preserved.
- [x] Official OAuth/server-only secrets dan no pre-confirm mutation explicit.
- [x] Credential subject rotation dan token-exchange executor/permissions explicit.
- [x] Stable copy intent, superseding serialization, and stale generation checks explicit.
- [x] Rate-limit scopes partner/global, credential subject, shop, endpoint explicit.
- [x] Outbox row locks vs queue-job leases terminology consistent.
- [x] PostgreSQL-first at-least-once, external attempts, `OUTCOME_UNKNOWN`, no blind retry explicit.
- [x] Unsafe destinations/shapes unpublished and per-destination isolated.
- [x] Analytics completeness/absence semantics explicit.
- [x] Phase gates, acceptance, crash tests, observability, rollout, ADR, risks, capability TODOs, staffing complete.
