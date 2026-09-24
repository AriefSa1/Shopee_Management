# Secret Handling

Purpose: menentukan lokasi, akses, dan redaction untuk partner key, OAuth code/state, serta tokens. Status: approved baseline. Owner: Security Lead. Approval gate: Phase 2 exit and every deployment review.

Related: [credential-subject model](../requirements/credential-subject-model.md), [threat model](threat-model.md), [ADR-001](../architecture/ADR-001-modular-monolith.md).

## Classification and storage

- Partner key: secret manager, referenced by `partner_application_id`; never in database rows or client.
- OAuth state: hash for lookup; secret value only in secure server session/flow with short TTL.
- Callback code: encrypted envelope using authenticated context `oauth-callback-code`, short retention, worker-only decrypt.
- Access/refresh tokens: local AES-GCM envelope encryption with organization/app/credential-subject context, key version, expiry, revision, status.
- Authorization headers and raw upstream responses: transient worker memory only; never logs, traces, metrics, audit, queue, or error sink.

## Runtime access

`web` may validate state and request encryption for callback code. `shopee-worker` may read partner key and locally decrypt/encrypt code/tokens. `readonly-support` sees only safe projections. `migration` has DDL/grants only and is absent from runtime. Deny tests must prove this separation.

## Operational rules

Use structured allowlist logging, secret canaries, redaction tests, short-lived credentials, rotation with revision/lock, and no secret values in screenshots or support exports. Incident response revokes affected credential subject, preserves safe audit/evidence, and requires reauthorization rather than stale-token replay.
