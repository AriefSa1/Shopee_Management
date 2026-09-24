# Test Strategy

Purpose: menyediakan evidence untuk requirement, safety invariant, dan phase gates. Status: approved strategy. Owner: Test Lead/Verifier. Approval gate: Phase 1 foundation and updated at each phase.

Related: [acceptance criteria](../requirements/acceptance-criteria.md), [capability matrix](../requirements/shopee-capability-matrix.md), [copy state machine](../requirements/copy-product-state-machine.md), [rollback](../operations/rollback.md).

## Test layers

- Unit: RBAC/ownership/authz revision, OAuth state, grant/subject/binding resolver, encryption context, intent versions, hashes, state machine, absence semantics, limiter, redaction.
- PostgreSQL integration: actual DB roles/grants, composite constraints, outbox row locks, queue lease/fencing, unique schedule, commit-before-ack, DLQ replay.
- Contract stub: redacted Shopee fixtures for OAuth, pagination, product fields, metrics, category requirements, rate responses, media/item/variation responses. Fixtures must cite capability evidence and must not imply unverified production behavior.
- Crash matrix: worker death before send, during send, after response, before result commit, after commit-before-ack; token rotation crash; callback timeout; dispatcher rollback.
- E2E: Owner multi-shop OAuth, role/forged request checks, catalog filters, analytics absence, 10-shop 7/3 scenario, supersede, revocation, duplicate click/replay, unknown recovery, accessibility/responsive.
- Observability: correlation chain, no-secret scan, unknown alerts, queue age/lease, DLQ, rate scopes, incomplete analytics, pre-confirm mutation counter, DB/encryption denial.

## Mandatory invariants

1. All pre-confirm/invalid/stale/revoked paths make zero mutating Shopee calls.
2. `OUTCOME_UNKNOWN` cannot auto-retry.
3. Destination jobs are isolated and idempotent.
4. Worker is the only token exchange/refresh authority.
5. Partial collection cannot claim complete analytics.

## Release evidence

Record test ID, fixture/evidence date, market/environment, actor role, expected state, observed state, and artifact path. Phase cannot pass if a required capability is `UNKNOWN`, a deny test fails, or a crash boundary has no result.
