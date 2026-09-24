# Copy Product State Machine

Purpose: safe, reviewable, per-destination copy dari satu source product ke banyak shop. Status: approved design; write path capability-gated. Owner: Domain/Security. Approval gate: Phase 5 preview, lalu pre-write gate sebelum Phase 6.

Related: [integration contracts](../architecture/integration-contracts.md), [external outcome recovery](../operations/external-outcome-recovery.md), [RBAC](rbac-matrix.md), [capability matrix](shopee-capability-matrix.md).

## Stable intent dan serialization

`copy_intent` adalah identitas logis stabil untuk source + destination + business operation. Preview/edit membuat command version baru; hanya satu `active_command_version` yang dapat dikonfirmasi. `serialization_generation` mencegah command lama dispatch setelah supersede. Jika mutation attempt sudah `STARTED` atau outcome unresolved, supersede ditolak dan recovery diwajibkan.

## States

```text
DRAFT -> REQUIREMENTS_LOADING -> NEEDS_INPUT | INVALID | VALIDATED
VALIDATED -> CONFIRMED -> QUEUED -> AUTHORIZATION_CHECK
AUTHORIZATION_CHECK -> MEDIA_UPLOADING -> ITEM_CREATING
ITEM_CREATING -> VARIATION_INITIALIZING -> SUCCEEDED
```

Non-mutating hold states: `AUTHORIZATION_REVOKED`, `SHOP_DISCONNECTED`, `COMMAND_STALE`, `FEATURE_DISABLED`, `UNSUPPORTED_SHAPE`, `TERMINAL_FAILED`, `SUPERSEDED`.

Recovery states: `RETRYABLE_FAILED`, `REAUTH_REQUIRED`, `REQUIREMENTS_STALE`, `OUTCOME_UNKNOWN`, `PARTIAL_CREATED`.

## Preview: zero mutation

Ambil immutable source snapshot dan read-only destination requirements: leaf category, mandatory attributes, brand, limits, logistics, shipping, dan media requirements. Validasi metadata media secara lokal; jangan upload. Simpan requirement completeness/freshness dan preview hash. Confirmation mengikat hash exact per destination.

## Confirmed execution

1. Revalidate actor, organization/shop ownership, grant/binding, feature/policy, intent version, requirement freshness, dan supported shape.
2. Commit `external_operation_attempt` untuk MediaSpace sebelum first mutation; upload hanya sesudah confirmation.
3. Revalidate revocation sebelum add-item.
4. Commit add-item attempt, kirim sekali, dan simpan durable upstream ID sebelum variation.
5. Jalankan variation hanya untuk shape yang confirmed safe.
6. Commit result, mapping, audit, dan queue acknowledgment.

Setiap destination memiliki job/attempt sendiri. Invalid destination tidak dikonfirmasi dan tidak didispatch.

## `OUTCOME_UNKNOWN`

Timeout, lost response, worker death after send, atau DB failure sebelum resource ID durable masuk `OUTCOME_UNKNOWN`. Normal retry dilarang. Resolution hanya melalui durable ID, official idempotency/correlation lookup, documented proof of absence, atau audited Owner decision. Evidence tidak boleh dihapus.

## Pre-write gate

Sebelum enabling mutation, reviewer harus mengonfirmasi MediaSpace lifecycle, add-item correlation/idempotency, visibility timing, variation atomicity, safe disable/repair, supported shapes, dan rate-limit scopes. Crash, revocation, supersede, 7-valid/3-invalid, dan zero-mutation tests wajib lulus.

