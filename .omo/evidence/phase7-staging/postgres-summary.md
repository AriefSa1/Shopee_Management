# Phase 7 PostgreSQL Staging Persistence Contract

## Scope

This evidence covers the existing provider-free PostgreSQL staging persistence contract. It does not connect to a live PostgreSQL server, read credentials, call Shopee, call KMS, deploy an environment, or enable a write pilot.

## Automated contract test

Invocation:

```text
node --experimental-strip-types --test packages/staging/src/postgres-staging.test.ts
```

Observable result: exit 0; **4 tests passed, 0 failed**, with no cancellations, skips, or todos. The four cases cover atomic save/read mapping, composite organization/shop isolation, preservation of unavailable state and an unknown capability, and the migration composite-key/fail-closed-flag contract.

## Manual QA

Invocation:

```text
node --experimental-strip-types packages/staging/src/manual-postgres-staging.ts
```

Observable result: exit 0. The captured artifact is `.artifacts/phase7/staging/manual-postgres-staging.json` and reports:

- `saveRead`, `compositeScopeIsolation`, `numericZeroPreserved`, `unavailableStatePreserved`, and `migrationContract`: `passed`;
- `statements`: `10` deterministic fake-Postgres statements;
- network calls, database calls, Shopee mutations, KMS calls, and external writes: `0`;
- `livePostgres`: `not_run`;
- `secretFieldsPresent`: `false`.

## Source evidence

The bounded contract is implemented and tested by:

- `packages/staging/src/postgres-staging.ts`
- `packages/staging/src/postgres-staging.fake.ts`
- `packages/staging/src/postgres-staging.test.ts`
- `packages/staging/src/manual-postgres-staging.ts`
- `db/migrations/0003_staging.sql`

Source SHA-256 values captured for the implementation and test harness:

| File | SHA-256 |
| --- | --- |
| `packages/staging/src/manual-postgres-staging.ts` | `76c1241f1999ac6966696c8f9e68a5d9f7948f65e12a7a15ff3cafcdc00dab03` |
| `packages/staging/src/postgres-staging.ts` | `744efc63a352de28d81ca6f8860ae75fb50a6c7239441f325acd0833cc67f2a7` |
| `packages/staging/src/postgres-staging.test.ts` | `886ac8a6b30d07cbbc836d9a80aec4c133b1a8f1500c814bf60a99fc48337055` |
| `packages/staging/src/model.ts` | `12f57b51d871273cbec1ce8480f81827e5474d91ffbc71ff1ff9077130ce90db` |

## Remaining gates

This is a confirmed bounded contract slice, not proof of production persistence. The remaining gates are live PostgreSQL migration/grant/locking/fencing/recovery validation, production KMS/secret-provider integration, deployment, real session/state-reader composition, official Shopee capability evidence, a confirmed write worker, and explicit pilot authorization. Until those gates are independently evidenced, the staging feature remains fail-closed and Shopee mutation remains disabled.
