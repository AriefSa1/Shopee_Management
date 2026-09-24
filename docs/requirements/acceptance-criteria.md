# Acceptance Criteria

Purpose: acceptance yang dapat diuji untuk MVP. Status: approved baseline. Owner: Test Lead/Product. Approval gate: Phase 0, lalu evidence review pada gate tiap phase. Referensi: [PRD](PRD.md), [test strategy](../testing/test-strategy.md).

## Product, security, dan ownership

- **AC-01** Owner dapat menyelesaikan official OAuth dan menyimpan grant, credential subject, shop mapping, serta connection terpisah untuk setiap shop yang dikembalikan.
- **AC-02** Web, client payload, log, trace, metric, audit, queue payload, dan error sink tidak berisi partner key, code, OAuth state secret, access token, refresh token, atau authorization header.
- **AC-03** `shopee-worker` adalah satu-satunya runtime yang dapat membaca partner key dan mendekripsi token/code secara lokal; web, migration runtime, dan readonly-support ditolak oleh policy DB/enkripsi/network.
- **AC-04** Shop ID dari organisasi lain, membership revoked, binding yang tidak cocok, atau forged resource ID ditolak tanpa upstream call.
- **AC-05** Shared credential subject refresh terserialisasi; independent subjects dapat refresh mandiri; crash setelah possible rotation menjadi unknown/reauth, bukan stale retry.

## Catalog dan analytics

- **AC-06** Catalog dapat difilter berdasarkan shop, status, category, SKU, stock state, dan sync state.
- **AC-07** Detail dan variant hanya menampilkan data yang scoped ke shop pemilik; incomplete scan tidak mengklaim deletion atau complete catalog.
- **AC-08** Setiap analytics snapshot menunjukkan metric definition, source window, as-of/freshness, capability, dan collection completeness.
- **AC-09** `VALUE=0`, `MISSING`, `UNSUPPORTED`, `NOT_RETURNED`, dan `STALE` dibedakan; partial/incompatible run tidak menghasilkan comparison claim.

## Copy dan publication

- **AC-10** Source ke 10 destination menghasilkan 10 preview independen; 3 invalid/unsafe tidak dapat dipilih untuk confirmation, 7 valid dapat dipilih.
- **AC-11** Sebelum confirmation, total MediaSpace/product/status/variation/cleanup mutation ke Shopee adalah zero.
- **AC-12** Confirmation hanya Owner/Admin aktif, mencatat actor/authz/policy/feature revision, dan mengikat exact source/requirements/preview hashes.
- **AC-13** Destination failure tidak memblokir destination valid dan tidak membuat listing yang belum direview.
- **AC-14** Retry/replay tidak membuat duplicate listing pada destination yang sudah terminal success; stale or superseded command tidak melakukan upstream call.
- **AC-15** Unsupported visibility/variation/product shape tidak dapat dikonfirmasi atau didispatch.
- **AC-16** Mutation selalu memiliki committed external attempt sebelum send. Timeout, worker death, lost response, atau DB failure sebelum durable ID menghasilkan `OUTCOME_UNKNOWN` dan memblokir blind retry.
- **AC-17** Revocation, disconnect, stale requirements, atau disabled feature sebelum mutation menghasilkan exact non-mutating state; setelah possible send, sistem masuk recovery.

## Delivery, audit, dan operations

- **AC-18** Duplicate outbox scan/job delivery, expired lease, stale fencing generation, lost ack, DLQ replay, dan schedule collision tetap satu logical command.
- **AC-19** Limiter menggunakan semua discovered scopes: partner/global, credential subject, shop, endpoint; scope unknown memakai conservative behavior.
- **AC-20** Semua lifecycle sensitif menghasilkan correlated, secret-free audit event.
- **AC-21** Shopee outage mempertahankan local read, menandai stale state, dan menggunakan bounded retry/backoff.
- **AC-22** Core flow accessible dan usable pada desktop/tablet/mobile browser.
- **AC-23** Pilot report memakai frozen comparable workflow/shop/item/time method dan lulus jika penghematan waktu minimal 50%.

## Evidence rule

Setiap AC membutuhkan test ID dan artifact evidence. Tidak boleh menandai pass berdasarkan mock yang tidak memeriksa capability resmi. Unknown capability tetap blocking pada phase yang dicatat di [matrix](shopee-capability-matrix.md).
