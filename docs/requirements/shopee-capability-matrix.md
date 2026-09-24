# Shopee Capability Matrix

Purpose: register capability yang sudah didukung bukti resmi dan yang masih harus diverifikasi. Status: Phase 2 OAuth evidence updated, tidak boleh dianggap sebagai izin menjalankan pertukaran token live tanpa preflight runtime. Owner: Shopee Integration Lead. Approval gate: relevant phase dan pre-write gate. Evidence date: 2026-09-16 Asia/Jakarta.

Official references: [introduction](https://open.shopee.com/developer-guide/4), [authorization](https://open.shopee.com/developer-guide/20), [product preparation](https://open.shopee.com/developer-guide/209), [product creation](https://open.shopee.com/developer-guide/211), [product information](https://open.shopee.com/developer-guide/221).

| ID | Capability/evidence | Status | Blocking phase | Evidence / TODO |
| --- | --- | --- | --- | --- |
| CAP-01 | OAuth seller flow, callback code/state, shop/main-account authorization | CONFIRMED | Phase 2 | Official authorization guide viewed 2026-09-16: global production authorization URL is `https://open.shopee.com/auth`; required parameters are `partner_id`, `auth_type=seller`, `redirect_uri`, and `response_type=code`; `state` is an optional CSRF value returned unchanged. Shop authorization redirects with `code` and `shop_id`; main-account authorization redirects with `code` and `main_account_id`. Console redirect-domain configuration and the app's granted scopes remain deployment gates. |
| CAP-02 | Authorization-start signing requirement | CONFIRMED | Phase 2 | The current authorization-link parameter table does not require a signature. The application builds only the documented seller parameters and requires an HTTPS callback URL. Token exchange, not authorization-link creation, is signed. |
| CAP-03 | Credential subject lineage for main account, merchant, and shops | PARTIAL | Phase 2 | Guide describes multi-shop and shop list; actual shared/independent token lineage must be captured from exchange evidence. |
| CAP-04 | Access/refresh expiry, rotation, replay and recovery | PARTIAL | Phase 2 | Official guide viewed 2026-09-16 documents a 4-hour access token and a 30-day refresh token. Refresh returns a new refresh token that must be used next; a refresh token is single-use for either a shop or merchant. Crash recovery and actual market/app response remain runtime gates. |
| CAP-05 | Product list/base/model/extra information | PARTIAL | Phase 3 | Product guide names documented operations; exact fields, permissions, pagination and regional behavior remain TODO. |
| CAP-06 | Analytics fields and windows | PARTIAL | Phase 4 | Candidate official fields: 30-day views, cumulative sales, likes, ratings, star rating; verify availability per app/market. |
| CAP-07 | Category, attributes, brand, limits, logistics, shipping | PARTIAL | Phase 5/pre-write | Product preparation guide requires shop-specific leaf category and requirements; exact schemas and limits are TODO. |
| CAP-08 | MediaSpace upload and handle lifecycle | UNKNOWN | Pre-write | Verify preconditions, handle lifetime/reuse, orphan expiry and non-destructive cleanup. |
| CAP-09 | Add-item response, correlation, idempotency, unique lookup | UNKNOWN | Pre-write | Required to resolve ambiguous creates; no blind retry until evidence exists. |
| CAP-10 | Draft/hidden/default visibility and public timing | UNKNOWN | Pre-write | Unsafe shapes remain disabled if incomplete listing can become public. |
| CAP-11 | Variant ordering, atomicity, disable/repair | PARTIAL | Pre-write | Creation guide documents tier variation operation; verify ordering, atomicity and safe repair. |
| CAP-12 | Supported simple/variant product shapes | UNKNOWN | Pre-write | Enable only tested shapes with complete/contained publication semantics. |
| CAP-13 | Rate-limit scope/window/burst/headers/errors | UNKNOWN | Phase 2-6 | Discover partner/global, credential subject, shop and endpoint scopes per market; unknown scope uses conservative limiter. |
| CAP-14 | Pagination and completeness semantics | UNKNOWN | Phase 3-4 | Verify count/cursor behavior and incomplete-page semantics before claiming complete data. |
| CAP-15 | Regional host/signature/canonical request behavior | PARTIAL | Phase 2 | Official guide viewed 2026-09-16 confirms global production token exchange as `POST https://partner.shopeemobile.com/api/v2/auth/token/get`. Query parameters are `partner_id`, `timestamp`, `sign`; signature base is `partner_id + API path + timestamp`, HMAC-SHA256 with partner key, lower-case hexadecimal. Request JSON includes `code`, numeric `partner_id`, and exactly one of `shop_id` or `main_account_id`. Regional variants, app scopes, and live response evidence remain required. |

Evidence entry must include source URL, market, environment, observed date, app permission, request/response redacted fixture, reviewer, and next gate. A row cannot move to `CONFIRMED` from memory or an undocumented assumption.
