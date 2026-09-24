# Shopee Multi-Store Product Management

Purpose: pintu masuk untuk requirement, execution gates, dan checkpoint implementasi aplikasi internal multi-toko Shopee. Status: implementation checkpoint; read paths dan safety contracts teruji, write ke Shopee tetap disabled sampai external capability gates lulus. Owner: Product/Technical Lead. Approval gate: Phase 0 review before implementation; Phase 7 review before pilot.

## Tujuan

Aplikasi web internal untuk satu bisnis yang mengelola beberapa toko Shopee melalui satu dashboard. MVP memusatkan katalog produk, menampilkan analitik produk yang benar-benar tersedia dari API resmi, dan menyalin produk ke beberapa toko tujuan dengan preview, validasi, konfirmasi eksplisit, serta isolasi per toko.

Target pilot: setelah 30 hari, waktu untuk workflow pengelolaan produk lintas toko yang sebanding turun minimal 50% dari baseline yang dibekukan sebelum pilot.

## Batasan utama

- Integrasi hanya melalui Shopee Open Platform OAuth resmi. Cookie dan browser automation bukan fallback.
- Partner key, OAuth code/state, access token, refresh token, dan header otorisasi hanya berada di server/worker yang berwenang.
- Roles: Owner, Admin, Staff. Aplikasi ini internal single-business, bukan SaaS publik.
- Tidak ada mutation ke Shopee sebelum konfirmasi eksplisit, termasuk upload MediaSpace.
- Destination yang invalid atau unsafe tetap unpublished. `OUTCOME_UNKNOWN` menghentikan blind retry.
- Endpoint permission, quota, market behavior, listing visibility, dan capability lain yang belum terbukti tetap `UNKNOWN/TODO`.

## Dokumen

- [PRD](docs/requirements/PRD.md)
- [Acceptance criteria](docs/requirements/acceptance-criteria.md)
- [Shopee capability matrix](docs/requirements/shopee-capability-matrix.md)
- [Credential-subject model](docs/requirements/credential-subject-model.md)
- [Analytics semantics](docs/requirements/analytics-semantics.md)
- [Copy-product state machine](docs/requirements/copy-product-state-machine.md)
- [RBAC matrix](docs/requirements/rbac-matrix.md)
- [ADR-001 modular monolith](docs/architecture/ADR-001-modular-monolith.md)
- [Data model](docs/architecture/data-model.md)
- [Integration contracts](docs/architecture/integration-contracts.md)
- [Threat model](docs/security/threat-model.md)
- [Secret handling](docs/security/secret-handling.md)
- [Test strategy](docs/testing/test-strategy.md)
- [Pilot measurement](docs/operations/pilot-measurement.md)
- [External outcome recovery](docs/operations/external-outcome-recovery.md)
- [Runbooks](docs/operations/runbooks.md)
- [Hostinger Business deployment](docs/hostinger-business-deployment.md)
- [Rollback](docs/operations/rollback.md)
- [Roadmap](docs/roadmap.md)

## Official references

- [Open Platform introduction](https://open.shopee.com/developer-guide/4)
- [Authorization](https://open.shopee.com/developer-guide/20)
- [Product preparation](https://open.shopee.com/developer-guide/209)
- [Product creation](https://open.shopee.com/developer-guide/211)
- [Product information](https://open.shopee.com/developer-guide/221)

## Status dan otorisasi

Dokumen ini menyusun requirement dan execution gates. Implementasi lokal pada checkpoint ini tidak mengizinkan penggunaan credential nyata, pembelian layanan, deployment production, atau operasi destruktif. Keputusan scope expansion, biaya eksternal, credential nyata, production deployment, dan perubahan invariant publikasi tetap memerlukan persetujuan user.
