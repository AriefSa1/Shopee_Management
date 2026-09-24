# Aktivasi OAuth Shopee Live

Dokumen ini adalah runbook aktivasi untuk app Shopee Seller In House System. Jalankan hanya setelah deployment memiliki HTTPS publik. Jangan menempelkan partner key, authorization code, access token, atau refresh token ke terminal, issue tracker, browser query manual, atau berkas dokumentasi.

## Kondisi kode saat ini

- URL otorisasi global production dibangun ke `https://open.shopee.com/auth` dengan `partner_id`, `auth_type=seller`, `redirect_uri`, `response_type=code`, dan state CSRF acak.
- Worker menggunakan `POST https://partner.shopeemobile.com/api/v2/auth/token/get`; request ditandatangani HMAC-SHA256 atas `partner_id + /api/v2/auth/token/get + timestamp`.
- Callback code dan refresh token hanya boleh diproses oleh worker. Handoff callback disegel sebelum masuk antrean dan refresh token disegel sebelum disimpan.
- Exchange yang berhasil menyimpan credential subject, binding toko, dan grant dalam satu transaksi. Mode provider-commit mencegah penulisan grant kedua.
- Access token tidak boleh menjadi konfigurasi manual atau disimpan dalam respons web.

## Gate yang wajib selesai sebelum otorisasi pertama

### 1. Enkripsi lokal dan identitas service

Proyek memakai enkripsi lokal AES-256-GCM dengan satu secret yang khusus dibaca worker. Buat dan simpan key pada secret scope worker, bukan repository. Ikuti [runbook enkripsi lokal worker](local-encryption-hostinger-worker.md) sebelum aktivasi live.

Policy minimum:

| Runtime | Izin enkripsi |
| --- | --- |
| Web | encrypt/seal callback code saja; tanpa decrypt/unseal |
| Worker | encrypt/seal dan decrypt/unseal untuk callback code serta refresh token |
| Migration dan readonly support | tanpa akses key lokal |

Adapter envelope meneruskan encryption context sebagai authenticated additional data. Uji round-trip worker dan pastikan web tidak mempunyai secret key worker atau capability decrypt.

### 2. Identitas operator dan organisasi

Web tidak boleh menggunakan bearer fixture atau header buatan pengguna sebagai identitas produksi. Hubungkan autentikasi produksi ke `OAuthWebApiDependencies.authenticate` dan `authorize`.

Aturan minimum:

- Hanya Owner organisasi boleh memulai atau menerima callback OAuth, sesuai RBAC koneksi toko.
- Organization ID berasal dari session/identity server, bukan query parameter.
- Actor issuer dan subject yang menyelesaikan callback harus sama dengan actor yang memulai state.
- Route callback tetap membutuhkan session operator yang sama atau mekanisme callback-session yang setara dan telah diaudit; jangan membuat callback publik tanpa pembuktian actor.

Implementasi internal memakai `POST /api/session/login` dengan bootstrap token acak 32 byte. Token hanya dipakai untuk membuat cookie session `HttpOnly`, `Secure`, dan `SameSite=Lax`; token tidak dikirim pada request OAuth berikutnya. Session mengikat tepat satu `INTERNAL_ORGANIZATION_ID` dan `INTERNAL_AUTH_SUBJECT`. Authorization live kemudian memeriksa membership `owner` aktif di PostgreSQL.

Konfigurasi web live minimum:

```dotenv
SHOPEE_LIVE_OAUTH_ENABLED=true
PUBLIC_BASE_URL=https://DOMAIN
INTERNAL_ORGANIZATION_ID=<uuid-organisasi>
INTERNAL_AUTH_SUBJECT=<identitas-owner-internal>
INTERNAL_LOGIN_TOKEN=<32-byte-base64url>
WEB_SESSION_SECRET=<32-byte-base64url-yang-berbeda>
SHOPEE_PARTNER_ID=<live-partner-id>
SHOPEE_PARTNER_APPLICATION_ID=<uuid-aplikasi-internal>
WORKER_CREDENTIAL_ENCRYPTION_KEY=<32-byte-base64url>
CREDENTIAL_ENCRYPTION_KEY_VERSION=1
OAUTH_STATE_LIFETIME_SECONDS=600
```

Buat setiap secret 32 byte secara terpisah dan jangan menyalinnya ke log atau chat:

```powershell
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))"
```

### 3. HTTPS dan Shopee Open Console

1. Deploy web ke domain HTTPS publik.
2. Tentukan callback penuh, misalnya `https://DOMAIN/api/auth/shopee/callback`.
3. Di Shopee Open Console, masukkan domain callback yang sama pada **Live Redirect URL Domain**. Console menerima domain; aplikasi menggunakan callback URL lengkap.
4. Pastikan host pada `redirect_uri` cocok persis dengan domain Live Redirect URL Domain. Localhost dan HTTP tidak boleh digunakan untuk live.
5. Jangan mengaktifkan IP whitelist kecuali IP egress deployment sudah statis dan tervalidasi. Jika diaktifkan, masukkan IP egress worker, bukan IP komputer pengembang.

### 4. Konfigurasi worker

Simpan partner credential hanya di secret manager yang dapat dibaca identity worker. Tambahkan konfigurasi non-rahasia berikut pada runtime worker:

```dotenv
SHOPEE_API_BASE_URL=https://partner.shopeemobile.com
SHOPEE_OAUTH_TIMEOUT_MS=12000
```

`SHOPEE_PARTNER_KEY` harus diinjeksikan melalui `ShopeeSecretProvider` worker, bukan dicetak atau dikirim ke web. `SHOPEE_PARTNER_ID` bukan credential rahasia dan dipakai web untuk membangun URL otorisasi. Karena deployment ini sengaja tidak memakai KMS, web membutuhkan `WORKER_CREDENTIAL_ENCRYPTION_KEY` untuk mengenkripsi callback code sebelum handoff; policy runtime menolak operasi unseal pada role web. Konsekuensinya, kompromi penuh terhadap process/environment web tetap dapat memperoleh symmetric key. Ini adalah residual risk dari pilihan enkripsi lokal satu-deployment dan harus diterima secara eksplisit. Jangan mengisi `SHOPEE_ACCESS_TOKEN` atau `SHOPEE_REFRESH_TOKEN` secara manual; keduanya merupakan hasil OAuth dan harus melalui flow terenkripsi.

### 5. Mapping toko sebelum callback

Sebelum seller melakukan otorisasi, siapkan satu `shop_connections` aktif yang cocok dengan semua scope berikut:

| Scope | Nilai yang harus cocok |
| --- | --- |
| organisasi | Organization ID operator |
| partner application | ID internal aplikasi partner yang dipilih operator |
| market | `ID` |
| external shop ID | `1819834906` |
| status | aktif |

Resolver akan menolak exchange apabila satu pun scope tersebut tidak cocok. Jangan mengganti UUID internal dengan `shop_id` Shopee; keduanya adalah identifier berbeda.

## Urutan aktivasi terkontrol

1. Deploy web dan worker dengan observability yang hanya mencatat safe event/error code, tanpa body request Shopee.
2. Jalankan smoke endpoint deployment: `/health` dan `/ready` harus HTTP 200 untuk web maupun worker.
3. Jalankan preflight enkripsi: web dapat seal tetapi ditolak saat unseal; worker dapat seal dan unseal dengan encryption context yang tepat.
4. Verifikasi mapping toko aktif untuk shop `1819834906` menggunakan account database yang hanya memiliki izin read.
5. Set `SHOPEE_LIVE_OAUTH_ENABLED=true`, restart web, lalu pastikan route start tanpa cookie menghasilkan HTTP 401, bukan 404.
6. Login melalui `POST /api/session/login`, lalu dari session Owner buat authorization URL dan verifikasi `redirect_uri` HTTPS serta domainnya sesuai Console.
7. Otorisasi satu toko terlebih dahulu. Jangan ulangi atau refresh callback URL: `code` berlaku sekali dan maksimum 10 menit.
8. Verifikasi hasil hanya dengan metadata aman: status queue `completed`, satu credential subject aktif, satu binding toko aktif, dan satu grant aktif. Jangan query atau tampilkan plaintext token.
9. Jalankan refresh token terjadwal untuk satu toko dan verifikasi revision bertambah. Jika hasil provider atau persistence tidak pasti, tandai reauthorization required; jangan blind retry.

## Bukti penerimaan yang harus dicatat

Simpan hanya metadata berikut pada ticket/ledger internal: environment, market, domain callback, waktu uji, organization ID ter-redaksi, external shop ID, status gate enkripsi, status mapping, status queue, request ID Shopee bila aman, dan hasil akhir. Jangan simpan credential, callback code, state, query string callback, header, atau raw upstream payload.

## Kondisi yang menghentikan aktivasi

- Secret key worker belum tersedia atau web masih bisa decrypt.
- Tidak ada authenticated Owner dan organisasi terpercaya pada route OAuth.
- Callback domain tidak identik dengan konfigurasi Console.
- Tidak ada `shop_connections` aktif untuk scope toko yang akan diotorisasi.
- Worker atau database belum `ready`.
- Provider mengembalikan error atau evidence `authorizedShopId` tidak sama dengan claim callback.
