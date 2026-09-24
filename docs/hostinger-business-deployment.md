# Deploy Web Dashboard di Hostinger Business

Dokumen ini membahas deployment **web dashboard** pada Hostinger Business Web Hosting. Hostinger mendukung Node.js app pada paket Business dan mendukung Node 18, 20, 22, serta 24. Proyek ini memakai Node 24 dan `pnpm`.

Untuk kebutuhan internal, Hostinger Business dapat memakai cron untuk menjalankan batch worker yang singkat. Jangan menjalankan `worker:start` sebagai cron: perintah itu membuka HTTP service dan tidak akan exit. Worker cron harus mengambil batch terbatas lalu selesai; lihat bagian [Worker OAuth](#worker-oauth).

## Perubahan yang sudah ada di proyek

- Script standar `pnpm start` menjalankan `apps/web/src/main.ts`.
- Web runtime memakai `WEB_PORT` bila tersedia, atau otomatis memakai `PORT` dari hosting platform. Tidak perlu menetapkan port internal secara manual di hPanel.
- Node 24 menjalankan entry TypeScript dengan `--experimental-strip-types`.
- `/health` dan `/ready` tersedia untuk pemeriksaan deployment tanpa membocorkan secret.

## Persiapan repository

1. Simpan kode di repository GitHub privat. Jangan commit `.env`, partner key, database password, callback code, access token, atau refresh token.
2. Pastikan root repository berisi `package.json` dan `pnpm-lock.yaml`.
3. Jalankan validasi lokal sebelum push:

   ```powershell
   Set-Location 'C:\Code\Shopee Management'
   pnpm.cmd install --frozen-lockfile
   pnpm.cmd run build
   ```

4. Push branch yang sudah lulus validasi ke GitHub.

## Konfigurasi di hPanel

1. Buka **Websites** lalu pilih **Add Website**.
2. Pilih **Deploy Web App** atau **Node.js Web App**.
3. Pilih **Import Git Repository**, hubungkan GitHub, lalu pilih repository dan branch deployment.
4. Pada pengaturan aplikasi pilih:

   | Pengaturan hPanel | Nilai |
   | --- | --- |
   | Framework | `Other` bila Hono tidak terdeteksi otomatis |
   | Node.js version | `24.x` |
   | Package manager | `pnpm` |
   | Build command | `pnpm run build` |
   | Start command | `pnpm start` |
   | Entry file, bila diminta | `apps/web/src/main.ts` |

5. Pada **Environment variables**, tambahkan environment web berikut:

   | Nama | Nilai |
   | --- | --- |
   | `APP_ENV` | `production` |
   | `WEB_HOST` | `0.0.0.0` |
   | `DATABASE_URL` | URL PostgreSQL production yang sudah dimigrasikan |
   | `SHOPEE_LIVE_OAUTH_ENABLED` | `true` setelah seluruh gate siap |
   | `PUBLIC_BASE_URL` | Origin HTTPS dashboard tanpa path |
   | `INTERNAL_ORGANIZATION_ID` | UUID organisasi internal |
   | `INTERNAL_AUTH_SUBJECT` | Identitas Owner internal |
   | `INTERNAL_LOGIN_TOKEN` | Random 32 byte base64url |
   | `WEB_SESSION_SECRET` | Random 32 byte base64url yang berbeda |
   | `SHOPEE_PARTNER_ID` | Live Partner ID |
   | `SHOPEE_PARTNER_APPLICATION_ID` | UUID aplikasi partner internal |
   | `WORKER_CREDENTIAL_ENCRYPTION_KEY` | Random 32 byte base64url untuk seal callback |
   | `CREDENTIAL_ENCRYPTION_KEY_VERSION` | `1` |
   | `OAUTH_STATE_LIFETIME_SECONDS` | `600` |

   Jangan mengisi `PORT`; Hostinger memberikannya sendiri dan runtime akan membacanya. Jangan masukkan `SHOPEE_PARTNER_KEY`, `SHOPEE_ACCESS_TOKEN`, atau `SHOPEE_REFRESH_TOKEN` ke aplikasi web Hostinger. Pilihan tanpa KMS membuat web memerlukan symmetric key untuk seal callback; policy aplikasi menolak unseal di web, tetapi environment compromise tetap menjadi residual risk.

6. Klik **Deploy**. Bila build gagal, buka **Deployments**, pilih deployment gagal, lalu baca log build. Periksa root directory, Node 24, package manager `pnpm`, dan nama environment variable; jangan menyalin isi secret dari log ke chat atau issue.

## Verifikasi sesudah deploy

Setelah hPanel menyatakan deployment selesai dan domain temporary tersedia, buka:

```text
https://DOMAIN-ANDA/health
https://DOMAIN-ANDA/ready
```

Hasil yang diharapkan:

```json
{"service":"web","status":"ok"}
```

dan:

```json
{"service":"web","status":"ready","dependencies":{"database":{"state":"ready","reason":"probe_succeeded"}}}
```

Jika `/ready` menghasilkan HTTP 503, deployment web berjalan tetapi database belum dapat dipakai. Periksa `DATABASE_URL`, firewall/allowlist database, serta apakah migration yang diperlukan sudah selesai. Jangan mencoba OAuth ketika `/ready` belum 200.

## Domain dan HTTPS

1. Hubungkan custom domain dari hPanel sesuai prosedur Hostinger.
2. Aktifkan SSL dan pastikan browser membuka `https://DOMAIN-ANDA` tanpa warning.
3. Untuk OAuth Shopee nantinya, callback lengkap adalah:

   ```text
   https://DOMAIN-ANDA/api/auth/shopee/callback
   ```

4. Masukkan domain yang sama pada **Live Redirect URL Domain** di Shopee Open Console. Domain pada `redirect_uri` harus cocok dengan konfigurasi Console.

## Worker OAuth dengan enkripsi lokal

Hostinger Business Web Hosting cocok untuk Node.js web app yang menerima traffic HTTP. Cron Hostinger dapat menjadi scheduler untuk batch kecil, tetapi bukan process manager untuk worker persisten.

Proyek sekarang menyediakan `pnpm worker:once`. Command ini membuat komposisi worker production sekali-jalan: antrean PostgreSQL, provider OAuth Shopee, dan enkripsi lokal AES-256-GCM. Worker membatasi claim per eksekusi, berhenti saat antrean kosong, menulis counter yang aman, lalu exit. Ia tidak membuka HTTP service.

Saat diaktifkan nanti, cron akan memakai pola berikut:

```text
cron Hostinger -> pnpm worker:once -> claim batch kecil -> persist outcome -> exit
```

Sebelum membuat cron, siapkan environment berikut pada **scope yang hanya dapat dibaca proses cron/worker**:

| Nama | Nilai atau sumber |
| --- | --- |
| `DATABASE_URL` | URL PostgreSQL production yang sudah dimigrasikan |
| `WORKER_CREDENTIAL_ENCRYPTION_KEY` | Key AES-256-GCM base64url 32 byte yang sama dengan web agar worker dapat membuka callback envelope |
| `CREDENTIAL_ENCRYPTION_KEY_VERSION` | `1` untuk key aplikasi pertama |
| `SHOPEE_API_BASE_URL` | `https://partner.shopeemobile.com` |
| `SHOPEE_OAUTH_TIMEOUT_MS` | `12000` |
| `SHOPEE_PARTNER_ID` | Secret Shopee worker |
| `SHOPEE_PARTNER_KEY` | Secret Shopee worker |

Jangan menaruh `SHOPEE_PARTNER_KEY` pada environment web. `SHOPEE_PARTNER_ID` dan encryption key diperlukan web untuk URL authorization dan seal callback, tetapi tidak boleh masuk client bundle, response, log, atau chat.

Hostinger mendokumentasikan bahwa cron **Custom** dapat menjalankan command atau script non-PHP, tetapi dokumentasinya tidak membuktikan bahwa secret cron terpisah dari environment web. Sebelum OAuth live, verifikasi di hPanel atau ke Hostinger Support bahwa variable di atas dapat dibatasi hanya untuk cron. Bila scope terpisah tidak tersedia, jangan aktifkan OAuth live pada deployment ini karena isolation secret worker belum terbukti.

Setelah scope secret terbukti terpisah dan deployment memiliki path project yang diketahui, buat cron dengan **Type: Custom** dan command berikut dari root project deployment:

```text
pnpm worker:once
```

Mulailah dengan jadwal paling jarang yang memenuhi operasional, amati output aman `worker_once_finished`, lalu naikkan frekuensi secara bertahap. Schedule cron Hostinger memakai UTC. Jangan memakai `worker:start` sebagai cron.

### Alternatif saat Hostinger tidak menyediakan Cron

Jika paket Hostinger tidak memiliki Custom Cron, worker dapat dijalankan inline di proses Node.js web. Aktifkan dua variabel berikut:

```text
INLINE_WORKER_ENABLED=true
INLINE_WORKER_INTERVAL_MS=30000
```

Mode ini menjalankan batch OAuth kecil setiap interval dari proses aplikasi web yang sudah hidup. `SHOPEE_PARTNER_KEY` dan `WORKER_CREDENTIAL_ENCRYPTION_KEY` harus tersedia pada environment aplikasi web karena tidak ada lagi pemisahan secret antara web dan worker. Ini menghilangkan ketergantungan pada Cron, tetapi meningkatkan dampak jika proses web atau environment web dikompromikan. Jangan aktifkan mode ini bila policy deployment mensyaratkan partner key tetap worker-only.

Mode inline juga menyediakan resolver katalog yang membaca binding credential toko dari PostgreSQL, me-refresh access token Shopee, menyimpan refresh token baru secara terenkripsi, lalu mengambil katalog toko yang dipilih. Setelah deploy, lakukan OAuth baru satu kali agar credential tersimpan di database; koneksi lama yang berhenti di `worker_exchange_pending` tidak diulang otomatis.

Sebelum cron dijadwalkan, jalankan sekali `pnpm worker:encryption-preflight`. Command ini membuktikan round-trip enkripsi lokal dengan fixture non-rahasia dan tidak memanggil Shopee atau database.

Panduan pembuatan dan pengelolaan key lokal ada di [runbook enkripsi lokal worker](local-encryption-hostinger-worker.md).

## Batas aktivasi saat ini

Deploy dashboard ke Hostinger dapat dilakukan setelah langkah di atas. Aktivasi OAuth live tetap ditahan sampai enkripsi lokal production teruji, identity Owner aktif, `SHOPEE_PARTNER_KEY` hanya tersedia pada cron/worker, dan mapping `shop_connections` untuk toko `1819834906` selesai. Detail gate OAuth ada di [live OAuth activation runbook](live-oauth-activation.md).

## Referensi resmi Hostinger

- [Deploy Node.js web app di Hostinger](https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/)
- [Pilihan Node.js version](https://www.hostinger.com/support/how-to-select-the-node-js-version-for-your-application/)
- [Environment variables Node.js](https://www.hostinger.com/support/how-to-add-environment-variables-during-node-js-application-deployment/)
- [Runtime logs Node.js](https://www.hostinger.com/support/how-to-use-node-js-runtime-logs-at-hostinger/)
- [Cron jobs Hostinger](https://www.hostinger.com/support/1583465-how-to-set-up-a-cron-job-at-hostinger/)
