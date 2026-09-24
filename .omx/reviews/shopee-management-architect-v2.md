# Architect Re-Review: Shopee Multi-Store Management v2

- Review stage: RALPLAN-DR deliberate Architect re-review
- Planner draft: `.omx/drafts/shopee-management-plan-v2.md`
- Verdict: `APPROVE`
- Execution authorization: None; this is planning-review evidence only.

## Summary

Planner v2 is architecturally sound and ready for the sequential Critic stage. All eight blocking changes from the prior Architect review have been resolved with authoritative states, data-model support, phase gates, and testable acceptance criteria. This approval does not authorize implementation, credential use, deployment, or execution handoff.

## Required-Change Verification

| Prior requirement | Result | Evidence |
| --- | --- | --- |
| No pre-confirmation mutation | Resolved | Zero Shopee mutation, including MediaSpace, is an invariant; preview is local/read-only and mutation begins only after confirmation (`.omx/drafts/shopee-management-plan-v2.md:45`, `:385`, `:572`, `:617`). |
| Separate shop and credential ownership | Resolved | Authorization grants, credential subjects, shop mappings, and bindings are separate; refresh locks by credential subject and covers shared/independent token lineages (`:177`, `:218`, `:563`, `:608`). |
| First-class `OUTCOME_UNKNOWN` | Resolved | The state is canonical and retry-blocking; every mutation has a durable attempt and crash boundaries are tested (`:360`, `:576`, `:611`). |
| Block unsafe product shapes | Resolved | Variant/visibility behavior is capability-gated; unsafe shapes are excluded unless the user explicitly changes the invariant (`:418`, `:534`, `:579`, `:634`). |
| Explicit asynchronous delivery | Resolved | PostgreSQL-first at-least-once delivery, atomic outbox/job insertion, leases, fencing, commit-before-ack, poison/dead-letter replay, scheduling dedupe, retention, and broker triggers are explicit (`:72`, `:258`, `:580`, `:610`). |
| Exact asynchronous RBAC | Resolved | Membership, ownership, grant/binding, hashes, feature policy, and attempts are revalidated before dispatch; post-send revocation enters recovery (`:33`, `:298`, `:573`, `:626`). |
| Analytics completeness | Resolved | Runs include page/item coverage, capability version, as-of intervals, and completeness; zero and absence states remain distinct (`:196`, `:337`, `:569`, `:619`). |
| Phase-gated documentation | Resolved | Entry, phase-dependent, pre-write, and pre-production documents have owners and approval gates (`:453`, `:741`). |

## Architectural Assessment

- Web, worker, migration, and support identities have separate database, network, KMS, and mutation authority, with denial tests required (`.omx/drafts/shopee-management-plan-v2.md:156`).
- PostgreSQL is the pilot durability boundary for domain state, outbox, jobs, scheduling, attempts, and acknowledgements (`:258`).
- Exact-once Shopee creation is not claimed. Ambiguous external outcomes require evidence-based reconciliation or operator resolution (`:408`).
- Capability uncertainty is a dated blocking matrix entry rather than an implementation assumption (`:21`, `:457`, `:534`).
- Tests cover database privileges, concurrency, network/commit crash boundaries, E2E revocation, accessibility, and observability (`:587`).
- Rollout starts with controlled staging, then read-only alpha, then a narrow write pilot (`:647`).

## Consensus Addendum

- **Antithesis:** A dedicated Shopee integration service offers a stronger credential and blast-radius boundary and becomes preferable if marketplaces multiply, write volume scales independently, separate teams form, or compliance requires datastore isolation.
- **Tradeoff:** PostgreSQL-backed jobs preserve atomic domain/outbox/job transitions and reduce pilot infrastructure, but compete with application workloads. Redis improves queue throughput but introduces another durability and duplicate-enqueue boundary.
- **Synthesis:** Retain the modular monolith and PostgreSQL-first jobs for MVP, enforce separate runtime/database identities, adopt a broker only on capacity evidence, and extract the integration service only on explicit scaling, organizational, marketplace, or compliance triggers.

## Non-Blocking Critic Watch Items

1. Name the token-exchange executor and its exact partner-key/KMS permissions in Phase 2.
2. Define stable logical copy intent and serialization across superseding command versions.
3. Apply discovered rate limits at every documented scope: partner/global, credential subject, shop, and endpoint.
4. Use consistent PostgreSQL-only outbox claim/row-lock terminology.

## Stop Condition

Architect review is complete with no blocking changes. Proceed to Critic sequentially using Planner v2 and this verdict. Do not begin implementation; the consensus gate remains incomplete until the final plan is approved and the documented execution handoff conditions are satisfied.
