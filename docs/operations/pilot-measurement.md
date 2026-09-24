# Pilot Measurement

Purpose: membuktikan target penghematan waktu secara comparable. Status: required before pilot. Owner: Product/Ops. Approval gate: baseline freeze before Phase 7; final report after 30 days.

Related: [PRD](../requirements/PRD.md), [roadmap](../roadmap.md), [runbooks](runbooks.md).

## Baseline

Sebelum dashboard dipakai, pilih workflow yang sama (catalog maintenance, performance review, atau copy listing), shop count, item count, actor role, dan periode observasi. Catat total active work time, number of shop visits/actions, failure/rework, dan sample IDs yang sudah dianonimkan. Bekukan definisi dan jangan mengganti denominator setelah pilot mulai.

## Pilot design

30 hari, Owner + satu operator awal, feature flag bertahap, satu supported simple shape dan satu destination terlebih dahulu. Tambah shop/shape hanya setelah recovery drill dan weekly review lulus. Catat downtime, stale data, validation failures, unknown outcomes, manual recovery, dan jobs per destination.

## Metric

`time_reduction = (baseline_minutes - pilot_minutes) / baseline_minutes`. Lulus jika workflow, shop count, item mix, dan quality threshold comparable serta reduction >= 50%. Laporkan median dan total, sample size, exclusions, confidence caveats, serta apakah manual recovery mengubah hasil.

## Stop rules

Hentikan write flag bila pre-confirm mutation counter non-zero, secret scan gagal, duplicate/unknown recovery tidak aman, unsupported shape terdispatch, atau rate/outage menyebabkan unbounded backlog. Read/audit/recovery tetap dipertahankan.

