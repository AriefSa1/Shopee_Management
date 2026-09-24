# ADR-001: TypeScript Modular Monolith dengan PostgreSQL-First Jobs

Purpose: merekam keputusan arsitektur MVP. Status: approved planning decision. Owner: Architecture Lead. Approval gate: Phase 1; re-open only with evidence.

## Decision

Gunakan TypeScript modular monolith dengan Next.js authenticated web/BFF, separate worker runtime, PostgreSQL sebagai source of truth untuk domain/outbox/queue/scheduler/attempts, typed validation, local AES-GCM envelope encryption, dan OpenTelemetry-compatible observability.

Web, worker, migration, dan readonly-support memiliki runtime identity, DB role, network policy, dan permission enkripsi berbeda. UI tidak mengimpor DB/Shopee adapter. Domain tidak bergantung pada adapter implementation.

## Delivery contract

Transaction domain command + audit + outbox adalah atomic. Dispatcher memakai PostgreSQL row lock `FOR UPDATE SKIP LOCKED` tanpa lease pada outbox, lalu membuat queue job unik. Queue job memakai lease dan fencing generation. Worker commit result/domain transition sebelum ack. Semua external writes memiliki durable attempt dan idempotent state transitions, tetapi sistem tidak mengklaim exactly-once Shopee write.

## Alternatives

- Redis/broker ditunda sampai load, queue SLO, dan retention evidence menunjukkan kebutuhan.
- Dedicated integration service ditunda sampai marketplace/team/write volume/compliance memerlukan isolation mandiri.
- Synchronous web + cron ditolak untuk write karena tidak memadai untuk partial success, leases, dan ambiguous outcome.

## Consequences

Positive: sedikit komponen, atomic outbox/job boundary, audit/recovery jelas, privilege separation. Negative: queue berbagi resource DB; index, retention, fencing, dan operator recovery harus disiplin.

## Re-open gates

Re-open bila measured DB queue SLO gagal setelah tuning, credential isolation/compliance berubah, atau marketplace/write volume membesar. Four watch clarifications wajib selesai sebelum execution: token-exchange executor/permissions, stable intent serialization, hierarchical rate scopes, dan row-lock versus lease terminology.
