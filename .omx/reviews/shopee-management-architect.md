# Architect Review: Shopee Multi-Store Management

- Stage: RALPLAN-DR deliberate Architect review
- Draft: `.omx/drafts/shopee-management-plan.md`
- Verdict: `ITERATE`

## Summary

The chosen TypeScript modular monolith with separately deployed web and worker processes is directionally sound. It balances MVP delivery speed with asynchronous Shopee integration. The draft is not implementation-ready because several high-risk distributed-state boundaries are described but not made authoritative or testable.

## Required Changes

1. **No pre-confirmation upstream mutation.** Remove the MediaSpace-upload exception. Preview validates local media metadata and destination rules; confirmed workers upload media as their first external step. Add a test proving zero Shopee mutations before confirmation.
2. **Separate shop ownership from credential ownership.** Introduce an authorization-grant/credential-subject entity. One grant may map to one or several shop connections depending on the official main-account response. Lock refresh and token revision by credential subject, not automatically by shop row. Define crash-after-rotation-before-DB-commit as `REAUTH_REQUIRED` unless Shopee provides a safe recovery contract.
3. **Make `OUTCOME_UNKNOWN` first-class.** Add it to the canonical copy-destination state machine and persist external-operation attempts. Never blindly retry if `add_item` may have reached Shopee. Resolve only through durable upstream ID, official correlation/lookup, proof of absence, or operator decision.
4. **Block unsafe product shapes.** Verify hidden/draft creation and variation atomicity per market/product shape. If a confirmed listing can become publicly incomplete and no safe disable/repair guarantee exists, exclude that shape from MVP unless the user explicitly changes the product invariant.
5. **Specify asynchronous delivery.** Declare at-least-once semantics and define outbox event IDs, leases, acknowledgements, duplicate enqueue behavior, worker commit/ack order, poison messages, dead-letter replay, retention, and scheduler deduplication. Prefer PostgreSQL-backed queue for pilot unless measured throughput justifies Redis.
6. **Complete asynchronous RBAC.** Remove conditional permission cells. Revalidate organization/shop ownership, connection status, actor revocation, command hashes, and feature flags before dispatch. Once a request may have been sent, use recovery states instead of pretending revocation can undo it.
7. **Model analytics collection completeness.** Add collection runs with pagination/completeness, expected/observed item counts, window, capability version, and as-of tolerance. Distinguish zero, missing, unsupported, stale, and not-returned.
8. **Phase-gate documentation.** Separate Phase 0 entry gates, phase-dependent documents, and pre-write/pre-production documents. Do not require every document before Phase 1. Add clear owner and approval gate.
9. **Repair trace metadata.** Mark deep-interview state inactive/crystallized and record Round 10.

## Steelman Counterargument

A dedicated Shopee integration service would provide a stronger credential and blast-radius boundary. It becomes justified if teams split, write throughput grows independently, additional marketplaces are added, or compliance requires hard isolation. For the MVP, the distributed authorization and deployment cost is premature.

## Synthesis

Keep one workspace and PostgreSQL source of truth, but use separate web and worker runtime identities and database roles. Web may create validated commands/outbox rows but cannot read token ciphertext or update publication results. Worker may decrypt credential grants and execute commands but cannot manage memberships or confirmation records. Use immutable versioned command envelopes and enforce package dependency boundaries in CI.

## Validation Required Before Approval

- Shared-versus-independent main-account credential behavior and concurrent refresh.
- Refresh rotation followed by database failure/process death.
- Duplicate callback and token-exchange persistence ordering.
- Zero MediaSpace/product mutation before confirmation.
- Worker death at all `add_item` boundaries.
- First-class `OUTCOME_UNKNOWN` and operator resolution.
- Listing visibility and variation atomicity by supported product shape.
- Duplicate enqueue, lost acknowledgement, stale lease, dead-letter replay, and scheduler deduplication.
- User demotion/deactivation and shop disconnection between confirmation and dispatch.
- Analytics comparisons with incomplete pages and incompatible coverage.

## Optional Improvements

- Use separate migration, web, worker, and read-only database roles.
- Enforce module dependency rules in CI.
- Key user identity by OIDC issuer plus subject.
- Scope external shop identifiers by partner app/market when global uniqueness is not proven.
- Add queue/outbox split-brain to the pre-mortem.
- Define observability cost/cardinality budgets.

