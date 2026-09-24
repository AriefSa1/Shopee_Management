# Credential-Subject Model

Purpose: memisahkan ownership shop dari lineage credential Shopee dan menetapkan refresh yang aman. Status: approved design; capability-dependent. Owner: Shopee Integration Lead + Security. Approval gate: Phase 2 exit.

Related: [secret handling](../security/secret-handling.md), [data model](../architecture/data-model.md), [integration contracts](../architecture/integration-contracts.md), [capability matrix](shopee-capability-matrix.md).

## Authorities

Empat pemeriksaan terpisah wajib lulus pada setiap call:

1. organization memiliki shop;
2. authorization grant aktif mencakup shop;
3. shop binding memilih credential subject aktif yang sesuai exchange evidence;
4. partner application dan market cocok.

`shop_connections` menyimpan safe shop metadata, bukan token. `credential_subjects` menyimpan satu token lineage aktual, encrypted dengan AES-GCM lokal, expiry, revision, status, dan key version. `shop_credential_bindings` menghubungkan shop ke subject berdasarkan evidence, sehingga satu subject dapat melayani beberapa shop bila memang dikonfirmasi.

## OAuth exchange

Web hanya memvalidasi/claim state, mengenkripsi callback code dengan context `oauth-callback-code`, lalu menulis immutable exchange command dan outbox. `shopee-worker` membaca partner key, decrypt code, melakukan exchange, dan menyimpan grant, subject(s), shop list, binding, serta attempt secara durable. Duplicate callback membaca hasil durable. Unknown exchange tidak boleh blind replay jika code replay safety belum terbukti.

Current official guide menyebut shop account dapat mengotorisasi satu shop, main account dapat mengotorisasi beberapa shop, code hanya sekali pakai, dan token exchange dapat mengembalikan shop list. Detail response/permission tetap [UNKNOWN](shopee-capability-matrix.md#capability-matrix).

## Refresh and rotation

- Lock pada `credential_subject_id`, bukan `shop_id`.
- Persist attempt `PREPARED`, acquire lock, re-read token revision, lalu `STARTED` dan refresh satu kali.
- Replace access/refresh ciphertext atomically dan increment revision; semua bound shop membaca winning revision.
- Invalid/revoked menandai subject dan bindings `REAUTH_REQUIRED`.
- Jika upstream mungkin telah merotasi token tetapi DB commit gagal, state menjadi `OUTCOME_UNKNOWN`; tanpa official recovery, pause subject dan minta reauthorization. Jangan memakai refresh token lama secara blind.

## Security gate

`shopee-worker` adalah satu-satunya token-exchange/refresh executor. Web tidak boleh membaca partner key, token ciphertext, atau melakukan Shopee exchange/refresh. DB/encryption deny tests dan redaction scan wajib pass pada Phase 2.
