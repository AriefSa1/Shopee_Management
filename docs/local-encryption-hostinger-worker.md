# Enkripsi Lokal Worker OAuth Hostinger

Worker OAuth memakai AES-256-GCM dari Node.js untuk mengenkripsi callback code dan refresh token sebelum data disimpan. Tidak ada AWS KMS, SDK AWS, IAM identity, atau credential AWS pada deployment ini.

## Batas keamanan yang penting

Enkripsi lokal hanya aman jika `WORKER_CREDENTIAL_ENCRYPTION_KEY` tersedia untuk worker cron dan tidak tersedia bagi aplikasi web. Sebelum OAuth live, verifikasi di hPanel atau ke Hostinger Support bahwa Custom Cron dapat menerima secret yang tidak dapat dibaca oleh Node.js Web App. Jika environment cron dan web berbagi semua secret, jangan aktifkan OAuth live.

Web tetap tidak memiliki capability decrypt. Namun, tanpa service KMS, perlindungan utama secret bergantung pada pemisahan environment Hostinger dan perlindungan access key hPanel.

## Konfigurasi worker

Tambahkan variabel berikut hanya pada scope cron/worker:

```dotenv
WORKER_CREDENTIAL_ENCRYPTION_KEY=...
CREDENTIAL_ENCRYPTION_KEY_VERSION=1
```

`WORKER_CREDENTIAL_ENCRYPTION_KEY` harus berupa 32 byte random dalam format base64url tanpa padding, tepat 43 karakter. `CREDENTIAL_ENCRYPTION_KEY_VERSION` adalah metadata envelope aplikasi dan mulai dari `1`.

Untuk membuat key baru di terminal pribadi Anda, jalankan satu kali:

```powershell
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Salin hasilnya langsung ke secret scope worker. Jangan menaruh nilai itu di `.env` yang di-commit, GitHub, screenshot, log, chat, atau environment web.

## Preflight

Setelah secret tersimpan pada worker, jalankan dari root project deployment:

```text
pnpm worker:encryption-preflight
```

Command ini melakukan round-trip AES-256-GCM dengan fixture non-rahasia. Ia tidak memanggil Shopee atau database. Output aman yang diharapkan:

```json
{
  "event": "worker_credential_encryption_preflight_finished",
  "result": {
    "status": "passed",
    "keyVersion": 1
  }
}
```

Setelah preflight berhasil, uji `pnpm worker:once` tanpa callback OAuth pending. Kemudian buat Hostinger Custom Cron dengan command `pnpm worker:once`.

## Rotasi key

Implementasi ini memakai satu key aktif. Jangan mengganti `WORKER_CREDENTIAL_ENCRYPTION_KEY` secara langsung pada sistem yang sudah memiliki refresh token terenkripsi: credential lama tidak akan dapat dibuka dan setiap toko yang terdampak harus melakukan OAuth ulang. Rencanakan migrasi multi-key sebelum melakukan rotasi tanpa reauthorization.
