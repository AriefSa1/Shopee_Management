# Data Model

Purpose: mendefinisikan ownership, constraints, dan durable state. Status: approved logical model; schema implementation pending. Owner: Domain/Architecture. Approval gate: Phase 1/2 and relevant phase exit.

Related: [credential-subject model](../requirements/credential-subject-model.md), [analytics semantics](../requirements/analytics-semantics.md), [copy state machine](../requirements/copy-product-state-machine.md), [ADR-001](ADR-001-modular-monolith.md).

## Global rules

Semua resource bisnis memiliki `organization_id`; external IDs di-scope oleh `partner_application_id` dan market hingga global uniqueness dibuktikan. Composite foreign keys mencegah cross-org references. Commands, confirmations, attempts, audit, dan published mappings immutable kecuali state transition yang didefinisikan.

## Entity groups

| Group | Entities | Minimum contract |
| --- | --- | --- |
| Identity | `organizations`, `users`, `memberships` | OIDC issuer+subject, role, active/revoked, authz revision. |
| Authorization | `partner_applications`, `oauth_attempts`, `authorization_grants`, `credential_subjects` | State hash/expiry, grant subject, encrypted token lineage, expiry/revision/status/key version. |
| Shop | `shop_connections`, `grant_shop_connections`, `shop_credential_bindings` | Safe metadata, ownership, grant coverage, subject mapping. |
| Catalog | `products`, `product_variants`, `sync_runs`, `sync_errors` | Scoped external IDs, upstream timestamps, page/item counts, completeness, safe errors. |
| Analytics | `metric_definitions`, `analytics_collection_runs`, `product_metric_snapshots` | Capability/version/window/as-of, complete status, value/absence state. |
| Copy | `copy_batches`, `copy_intents`, `copy_source_snapshots`, `destination_requirement_snapshots`, `copy_previews`, `copy_confirmations`, `copy_destination_commands/jobs` | Stable intent, immutable hashes/revisions, per-destination status/job. |
| External delivery | `external_operation_attempts`, `published_item_mappings` | Attempt UUID/fingerprint, credential subject, state, safe upstream IDs/correlation. |
| Delivery/ops | `outbox_events`, `queue_jobs`, `scheduled_triggers`, `dead_letter_jobs`, `audit_events`, `pilot_workflow_measurements` | Event/version/dedupe, lease/fencing, unique schedule slot, replay evidence, secret-free audit, frozen baseline. |

## Critical constraints

- Unique active command per logical intent and serialization generation.
- Unique outbox event and queue job by event ID.
- Queue lease commit requires current fencing generation.
- Published mapping is scoped by organization, app/market, destination, and logical intent.
- `OUTCOME_UNKNOWN` is terminal for automatic retry until approved evidence resolution.
- Metric `VALUE=0` is distinct from missing/unsupported/not-returned.

