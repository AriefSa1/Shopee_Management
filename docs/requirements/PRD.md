# PRD: Shopee Multi-Store Product Management

Purpose: mendefinisikan kebutuhan produk MVP. Status: approved planning baseline. Owner: Product/Technical Lead. Approval gate: Phase 0 traceability review.

## Masalah

Tim yang mengelola beberapa toko harus mengulangi pekerjaan katalog, pemeriksaan performa, dan pembuatan listing di Seller Centre. Fragmentasi ini meningkatkan waktu kerja dan risiko salah toko, field tidak valid, atau publikasi listing yang belum lengkap.

## Outcome dan metrik

Outcome utama adalah satu dashboard yang mengurangi waktu workflow produk lintas toko minimal 50% setelah pilot 30 hari dibanding workflow dan jumlah toko/item yang sebanding. Baseline, definisi workflow, dan metode pengukuran wajib dibekukan sebelum pilot; lihat [pilot measurement](../operations/pilot-measurement.md).

## Pengguna

| Pengguna | Kebutuhan |
| --- | --- |
| Owner | Mengotorisasi/memutuskan koneksi toko, mengelola anggota, mengonfirmasi publikasi, melihat audit penuh. |
| Admin | Mengelola katalog/analytics dan mengonfirmasi publikasi; tidak mengelola membership atau koneksi toko. |
| Staff | Membaca katalog/analytics, membuat preview, dan memperbaiki input; tidak mengonfirmasi publikasi atau mengelola koneksi. |

## MVP

1. **Katalog terpusat**: gabungkan produk dari setiap toko berizin; search/filter shop, status, category, SKU, stock state, sync state; tampilkan base information, variant, freshness, dan error actionable.
2. **Analitik produk**: tampilkan hanya field resmi yang tersedia untuk app/market. Kandidat awal yang terdokumentasi adalah 30-day views, cumulative sales, likes, ratings, dan star rating. Setiap nilai memiliki window, as-of, freshness, dan completeness.
3. **Salin produk antar-toko**: pilih satu source dan beberapa destination; ambil requirement destination; buat preview lokal yang dapat diedit; validasi per destination; Owner/Admin mengonfirmasi; worker mengeksekusi destination valid secara independen.

## Alur utama

1. Owner menjalankan OAuth resmi, state diklaim sekali, dan worker menyelesaikan exchange.
2. Worker menyimpan grant, credential subject, shop binding, dan safe shop metadata.
3. Catalog sync membaca produk secara paginated dan memberi label completeness.
4. User memilih source, destination, dan field editable; sistem membuat hash preview immutable.
5. Owner/Admin mengonfirmasi hash yang dipilih. Sebelum langkah ini, jumlah mutation Shopee harus nol.
6. Worker menjalankan setiap destination sebagai command/job terpisah. Failure satu destination tidak mengubah state destination lain.

## Non-goals

Orders/fulfillment, chat, ads/promotions/vouchers, accounting, warehouse, marketplace lain, real-time inventory sync, general bulk edit, AI content, autonomous listing change, native mobile, public SaaS, billing, dan multi-company tenancy.

## Invariant dan batas otorisasi

Official OAuth only; server-only secrets; organization/shop ownership checks; no pre-confirmation mutation; invalid/unsafe destination unpublished; no blind retry on possible external send; truthful analytics. User tetap memutuskan scope expansion, significant cost, real credentials, production deployment, destructive cleanup, dan perubahan invariant listing public.

## Requirement fungsional

- `FR-01`: Owner dapat mengotorisasi lebih dari satu shop dan melihat setiap shop sebagai connection terpisah.
- `FR-02`: Authorized user dapat mencari/filter catalog lintas shop dan membuka base/variant detail yang scoped ke owner shop.
- `FR-03`: Sistem menyimpan sync run, freshness, pagination, completeness, dan safe actionable error.
- `FR-04`: Analytics menampilkan definisi metric, period/window, as-of, dan absence state; unsupported metric tidak difabrikasi.
- `FR-05`: User dapat membuat preview satu source ke banyak destination, dengan validasi dan field-level error per destination.
- `FR-06`: Hanya Owner/Admin aktif yang dapat confirm publication; confirmation mengikat exact preview hash dan authorization revision.
- `FR-07`: Setiap destination memiliki intent, command, job, attempt, audit, dan recovery state independen.
- `FR-08`: RBAC, ownership, capability, feature flag, dan freshness direvalidasi sebelum worker dispatch.

## Gate keluaran

Phase 0 menghasilkan [acceptance criteria](acceptance-criteria.md), [capability matrix](shopee-capability-matrix.md), baseline pilot, dan traceability. Phase 5 hanya mengaktifkan preview lokal. Write hanya setelah [pre-write gate](copy-product-state-machine.md#pre-write-gate) selesai.

