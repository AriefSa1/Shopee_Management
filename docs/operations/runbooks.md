# Operational Runbooks

Purpose: baseline runbook untuk pilot dan pre-production. Status: required sections before write; full review pre-production. Owner: Ops Lead. Approval gate: pre-write for recovery sections, Phase 7 for full set.

Related: [external outcome recovery](external-outcome-recovery.md), [rollback](rollback.md), [secret handling](../security/secret-handling.md), [capability matrix](../requirements/shopee-capability-matrix.md).

## OAuth/reauthorization

Check safe connection status, grant expiry, credential subject status, and last redacted error. Pause affected subject/bound shops on revoked or unknown rotation. Reauthorize through official flow; never request cookie or paste token into support channel.

## Catalog/analytics degradation

Keep local reads available, label stale/incomplete, inspect collection run cursor/counts and limiter state, then replay only complete-safe read jobs. Do not claim deletion or comparison from incomplete runs.

## Copy job failure

Inspect destination-only state, command hash, attempt state, lease generation, and capability gate. Retry only definite transient failure. For unknown, follow [recovery](external-outcome-recovery.md). Invalid destinations remain unpublished.

## Queue/DLQ

Inspect outbox age, queue lease expiry, fencing rejection, duplicate event constraint, and poison reason. Replay by creating a new job referencing immutable command; do not edit original payload or bypass authorization.

## Rate limit/outage

Observe limiter scope, retry-after evidence, queue age, and oldest job. Reduce concurrency using conservative partner/global and shop limits when scope unknown. Escalate if backlog or unknown outcomes exceed pilot threshold.

## Incident evidence

Record correlation ID, safe shop/intent/job IDs, timestamps, capability version, state transitions, and operator decision. Never include secrets, tokens, headers, or raw upstream payloads.

