# Phase 5 local copy-preview fixture-contract verification

## Scope

This slice adds deterministic local-only contracts in `packages/copy-preview/**`. It captures allowlisted source and destination-requirement snapshots, validates explicit destination category and required attributes, computes stable SHA-256 hashes, builds per-destination previews, and advances one stable logical intent through local superseding serialization. It intentionally contains no environment access, HTTP client, Shopee SDK, database, queue, confirmation, or write adapter.

## Focused automated scenario

Invocation: `node --experimental-strip-types --test packages/copy-preview/src/copy-preview.test.ts`.

Exit code: `0`. Binary observable: `6` tests passed and `0` failed. The suite proves deterministic preview hashes; a preview retains captured values when the caller mutates its original fixture; incomplete source/requirements and unsupported mapping return invalid per-destination outcomes; a valid revision preserves logical intent while increasing command version and serialization generation; external-started state blocks superseding; the read-only adapter has mutation total `0` and a mutation attempt throws locally; and ten destinations are built independently in deterministic order.

Red-test evidence: before implementation, the same invocation exited `1` with `TypeError: preview.createCopyPreview is not a function`. That failed for the missing contract rather than an import or fixture error.

## Manual fixture scenario

Invocation: `node --experimental-strip-types packages/copy-preview/src/manual-copy-preview.ts`.

Exit code: `0`. Captured artifact: `.artifacts/phase5/copy-preview/manual-copy-preview.json`.

Binary observable: `previewKind` is `valid`, both destination preview kinds are `valid`, `supersedeKind` is `superseded`, `commandVersion` is `2`, the adapter is `read_only`, `preConfirmationShopeeMutationTotal` is `0`, `networkCalls` is `0`, and `secretFieldsPresent` is `false`.

## Source review and tooling gap

Pure non-comment LOC: `copy-preview.test.ts` 138, `copy-preview.ts` 156, `model.ts` 115, `manual-copy-preview.ts` 72, `serialization.ts` 38, and `index.ts` 31. Every source file is below 200 LOC and has one responsibility. The production boundary parses raw input once with Zod, uses readonly domain values/discriminated outcomes, and has no escape hatch or remote adapter.

`pnpm exec tsc --noEmit` could not begin validation because pnpm tried dependency setup and the managed filesystem denied its `_tmp_*` path with `ENOENT`. There is no local `node_modules` `tsc` or `biome` binary. The project-local no-excuse TypeScript checker could not resolve `typescript` for the same reason. None of those checks is claimed as passing.

No `.env` value was read. No real Shopee request, credential access, database connection, browser operation, external write, or upstream mutation occurred.

## Remaining pre-write and production gates

- Persist immutable snapshots, preview revisions, intent command versions, and serialization row locks in PostgreSQL; verify concurrent supersede behavior with real DB constraints.
- Add owner-scoped authorization/revocation checks, exact confirmation-hash binding, durable outbox/jobs, stale-command fencing, audit records, and an authenticated preview API/UI.
- Verify official Shopee destination category/attribute, media metadata, logistics, visibility, variation, correlation, idempotency, rate-limit, and recovery capability evidence in approved staging before any write adapter can be enabled.

## Source hashes

| File | SHA-256 |
| --- | --- |
| `packages/copy-preview/src/copy-preview.test.ts` | `ED855570E9DFD891F27AE6543C27ECE84A0BE1C3A57201E17A8A24D8635971CF` |
| `packages/copy-preview/src/copy-preview.ts` | `8BC9AEF75058208B7C013BD3F08C597B502438B04F44F590BB78DBDBC1F9EB13` |
| `packages/copy-preview/src/index.ts` | `CD7B8AB0A48A64C692BBEECCC558A0822D36369C9D76A4F1C1E7113154DF0137` |
| `packages/copy-preview/src/manual-copy-preview.ts` | `B94B88EF359370DA89F0C3C6BF33ACE5E329E1CCFA33993F115C5A0D5E13ECAB` |
| `packages/copy-preview/src/model.ts` | `9BC88492429BCE7CFC2272C01775DBEE2F3A4F59CE6024C44088F6F77568D2FC` |
| `packages/copy-preview/src/serialization.ts` | `FCBE02CD0553A38A6F2C975F52DCF40EEA48F2EA249F46E9D87879CD2189E77A` |
