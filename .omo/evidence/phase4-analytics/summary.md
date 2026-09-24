# Phase 4 analytics fixture-contract verification

## Scope

This slice adds deterministic analytics domain/API contracts under `packages/analytics/**`. It deliberately contains no Shopee HTTP adapter, credential lookup, environment access, database connection, UI, or external mutation.

The contract defines versioned metric definitions, per-shop collection runs, product snapshots, and explicit output states. `value: 0` remains a numeric result; `missing`, `unsupported`, and `not_returned` remain different absence meanings. A numeric snapshot older than the supplied deterministic tolerance projects as `stale`. A collection only becomes comparable when both runs are complete, metric definition/version/unit/window/organization agree, both snapshots are numeric, and both as-of timestamps are fresh.

## Focused automated scenario

Invocation:

`node --experimental-strip-types --test packages/analytics/src/analytics.test.ts`

Exit code: `0`.

Binary observable: `8` tests passed and `0` failed. The suite covers explicit zero preservation, complete-run missing fields, partial-run not-returned coverage, unsupported capability, capability/state contradiction rejection at the Zod fixture boundary, stale projection, eligible cross-shop comparison, and incomplete-run comparison denial.

Red test evidence: before the final capability-boundary implementation, the contradiction test failed with `AssertionError: Missing expected exception`; after the Zod `superRefine` contract was added, all eight tests passed.

## Manual fixture scenario

Invocation:

`node --experimental-strip-types packages/analytics/src/manual-analytics.ts | ConvertFrom-Json | ConvertTo-Json -Compress`

Exit code: `0`.

Captured artifact: `.artifacts/phase4/analytics/manual-analytics.json`.

Binary observable: the JSON has `runStatus: partial`, a real `zero` value of `0`, `omitted.kind: not_returned`, and `comparison.reason: collection_incomplete`. It also records `networkCalls: 0` and `secretFieldsPresent: false`.

## Source review and tooling gap

Pure non-comment LOC: `analytics.test.ts` 213 (warning band; test-file responsibility only), `collection.ts` 144, `model.ts` 107, `manual-analytics.ts` 72, `comparison.ts` 46, `projection.ts` 39, and `index.ts` 18. No production file exceeds 200 LOC. The source scan found no `as any`, `as unknown`, `@ts-ignore`, `@ts-expect-error`, TypeScript `enum`, or non-null assertion. `z.enum` calls are schema APIs, not TypeScript enum declarations.

`pnpm run typecheck` and `pnpm run lint` were both attempted after the final source change. Each exited `1` before type checking/linting because pnpm attempted dependency setup and the managed filesystem denied creation of its `_tmp_*` install path with `ENOENT`. No local `node_modules/.bin/tsc` or `node_modules/.bin/biome` exists, so neither validation is claimed as passing.

No `.env` was read. No real Shopee request, browser operation, database connection, external write, or mutation was made.

## Remaining production gates

- Validate official metric fields, definitions, permissions, windows, pagination/completeness, and as-of behavior in approved Shopee staging for the relevant market and partner app.
- Add durable PostgreSQL collection-run/snapshot storage, retention, ownership enforcement, and real DB-role allow/deny integration coverage.
- Add a role-correct analytics API/UI after its authenticated route and UI phase are authorized.

## Source hashes

| File | SHA-256 |
| --- | --- |
| `packages/analytics/src/analytics.test.ts` | `22287B3B2E63F96A390579BF0E5013C3FA7AC2807868F4989F07D38AD65407A3` |
| `packages/analytics/src/collection.ts` | `C69BDF16974E3FFA122C41FFA757F997C4A3658C1249384AF44598B0EEE3ACC6` |
| `packages/analytics/src/comparison.ts` | `DDB3D1EE6B2215FC9D0C0C43A327E238C49F1B5A62CEC0B212CC16DD060929D8` |
| `packages/analytics/src/index.ts` | `9DD8C28F62744B5AEA5ECB58937A247A5C4B256E68BB0901241EA79D6428D31F` |
| `packages/analytics/src/manual-analytics.ts` | `A807D232493070DF2D7CFCE2691313D22844B040D6144BC2051C206FEE109D0B` |
| `packages/analytics/src/model.ts` | `B00EE9FBAEA80D0265472DD9D2A51C558563D94ECCAC54604DFFB3C42EE0F49C` |
| `packages/analytics/src/projection.ts` | `60502C53D99EF7D62B0DCA2266C89AB95D9C1477A937031040DC279BAC8D3D9D` |
