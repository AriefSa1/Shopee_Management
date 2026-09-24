# Rollback and Stop/Go

Purpose: menghentikan write safely tanpa menghapus evidence. Status: required before production/pilot write. Owner: Ops/Architecture. Approval gate: Phase 7 pre-production.

Related: [ADR-001](../architecture/ADR-001-modular-monolith.md), [external outcome recovery](external-outcome-recovery.md), [pilot measurement](pilot-measurement.md).

## Rollback procedure

1. Disable copy confirmation and dispatch feature flag.
2. Hold queued pre-send jobs; do not delete commands, attempts, audit, or unknown evidence.
3. Keep catalog/analytics reads available with stale/incomplete labels.
4. Continue only read-only reconciliation and approved recovery for attempts that may have reached Shopee.
5. Preserve DB snapshot, queue state, capability evidence, and incident timeline.
6. Re-enable only after Security, Product, Architecture, Test/Verifier, and Shopee lead sign off.

Do not mark possible external mutations cancelled. Do not resend an unresolved add-item. Data cleanup/destructive removal remains user-reserved.

## Go criteria

All enabled capabilities confirmed, security/DB/encryption deny tests pass, crash/recovery runbooks exercised, backup/restore tested, rate limits bounded, supported shapes explicit, and credential/cost/deployment approval recorded.
