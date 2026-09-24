# Analytics Semantics

Purpose: mendefinisikan metric yang truthful, freshness, absence, dan completeness. Status: approved semantics; fields remain capability-gated. Owner: Analytics/Product. Approval gate: Phase 4 exit.

Related: [PRD](PRD.md), [capability matrix](shopee-capability-matrix.md), [data model](../architecture/data-model.md), [test strategy](../testing/test-strategy.md).

## Source boundary

Gunakan hanya field yang dikembalikan endpoint resmi dan diizinkan app/market. Official product information guide menyebut candidate `get_item_extra_info` metrics berupa views 30 hari, cumulative sales, likes, ratings, dan star rating; availability, exact field names, permission, dan regional behavior harus dikonfirmasi ulang pada Console.

Official references: [product information](https://open.shopee.com/developer-guide/221), [introduction](https://open.shopee.com/developer-guide/4).

## Collection run

Setiap collection membuat `analytics_collection_run` berisi capability version, requested window, start/end time, as-of minimum/maximum, expected/observed pages/items, cursor evidence, tolerance, dan status `COMPLETE`, `PARTIAL`, atau `FAILED`. Missing pages, cursor loop, response mismatch, atau incompatible capability mencegah aggregate/comparison claim.

## Value states

| State | Makna | UI/decision |
| --- | --- | --- |
| `VALUE=0` | Upstream secara eksplisit mengembalikan nol. | Tampilkan nol. |
| `MISSING` | Item sukses tetapi field supported absent/null. | Tampilkan “tidak tersedia pada item ini”. |
| `UNSUPPORTED` | App/market/endpoint tidak menyediakan metric. | Jangan tampilkan seolah nol; label capability. |
| `NOT_RETURNED` | Page/response tidak memuat field atau run belum lengkap. | Tidak eligible untuk comparison. |
| `STALE` | Nilai terakhir melewati freshness tolerance. | Tampilkan timestamp dan stale warning. |

Historical series hanya berasal dari snapshot yang disimpan aplikasi; tidak boleh diklaim sebagai historical upstream jika upstream hanya memberi current/cumulative value.

## Comparison eligibility

Comparison membutuhkan metric definition/version sama, unit/window sama, ownership valid, collection `COMPLETE`, as-of dalam tolerance, dan tidak ada absence state yang membuat denominator tidak sebanding. UI wajib menunjukkan source window dan last successful collection.

