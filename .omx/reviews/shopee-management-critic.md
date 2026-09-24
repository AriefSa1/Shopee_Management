# Critic Review: Shopee Multi-Store Management v2

- Review stage: final sequential RALPLAN-DR Critic review
- Planner draft: `.omx/drafts/shopee-management-plan-v2.md`
- Architect approval: `.omx/reviews/shopee-management-architect-v2.md`
- Verdict: `APPROVE`
- Execution authorization: None; planning and documentation only.

## Finding

Planner v2 is sufficiently clear, testable, complete, and evidence-bounded to become the final planning source for the PRD and supporting requirement files. No blocking change remains before planning-package materialization.

## Evidence Summary

- Scope remains the internal single-business MVP: centralized catalog, truthful product analytics, and safe cross-shop copy, with a 30-day target of at least 50% workflow-time reduction (`.omx/drafts/shopee-management-plan-v2.md:3`, `:25`).
- Official OAuth, server-only secrets, zero pre-confirmation mutation, shop/credential-subject separation, and first-class `OUTCOME_UNKNOWN` are enforceable invariants (`:45`, `:177`, `:218`, `:358`).
- PostgreSQL-first at-least-once delivery defines outbox, queue, lease/fencing, commit-before-ack, dead-letter replay, retention, and scheduler deduplication (`:258`).
- RBAC and execution-time revocation are explicit and testable (`:298`).
- Analytics collection completeness and absence semantics prevent unsupported or partial data from being presented as complete comparison (`:337`).
- Twenty-three acceptance criteria and the expanded unit, integration/crash-boundary, E2E, and observability test plan provide objective verification (`:561`, `:587`).
- Official-evidence unknowns remain dated capability gates rather than invented endpoint, permission, quota, or market assumptions (`:21`, `:453`, `:534`).
- User-reserved decisions remain reserved: scope expansion, significant cost, real credentials, production deployment, destructive operations, and changes to the safe-publication invariant (`:9`, `:557`, `:820`).

## Representative Simulations

1. A multi-shop main-account authorization persists the observed grant, credential subject lineage, shop mappings, and bindings without selecting a global first token.
2. A ten-destination copy produces independent previews; three invalid destinations remain unpublished while seven valid destinations may be confirmed.
3. A worker crash after `add_item` may have been sent enters `OUTCOME_UNKNOWN`, blocks blind resend, and requires durable evidence or an audited operator decision.
4. Analytics with incomplete pagination or incompatible observation windows cannot produce a complete comparison; `VALUE=0` remains distinct from missing or unsupported.

## Non-Blocking Phase-Gated Clarifications

The final plan must retain all four Architect watch items as explicit contracts:

1. `shopee-worker` is the sole token-exchange executor with narrowly scoped partner-key and KMS authority.
2. Stable `copy_intent_id`, monotonic command versions, and serialization prevent superseding-command races.
3. Rate limiting covers every discovered partner/global, credential-subject, shop, and endpoint scope.
4. PostgreSQL outbox row locking is distinguished from queue-job lease/fencing semantics.

These are implementation-phase hardening items with named gates, not blockers to the planning-package approval.

## Stop Condition

Critic review is complete. The plan may be finalized and requirement documents may be materialized. No source implementation, credential use, deployment, external spend, or destructive operation is authorized by this approval.
