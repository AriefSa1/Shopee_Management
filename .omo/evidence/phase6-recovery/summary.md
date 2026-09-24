# Phase 6 provider-free write recovery contract

This evidence covers only the local provider-free recovery contract. It does not enable Shopee writes.

- Unknown or denied capability produces `write_disabled` for every destination.
- Confirmation binds organization, actor, intent, preview hash, command version, and sorted destination payloads.
- Repeated planning yields a stable command identity and stable per-destination attempt identities.
- Dispatch requires a matching confirmation binding.
- `outcome_unknown` is terminal for dispatch and rejects blind retry.
- An operator may explicitly choose re-authentication, failure, or confirmed success.
- No network, database, KMS, Shopee, cookie, or secret access occurs.

Focused test command:

```text
node --experimental-strip-types --test packages/write-recovery/src/recovery.test.ts
```

Result: 8 tests passed, 0 failed.

Manual QA command:

```text
node --experimental-strip-types packages/write-recovery/src/manual-recovery.ts
```

Result: `write_disabled=true` for unknown capability, `destinationCount=2`, `blindRetryDenied=true`, `operatorResolution=reauth_required`, and all external-call counters are zero. The captured artifact is `.artifacts/phase6/recovery/manual-recovery.json`.

Remaining Phase 6 gates: official Shopee capability/permission verification, PostgreSQL persistence and idempotency, KMS-backed credential handling, deployed worker authentication, staging deployment, and human approval before any confirmed write. The write adapter remains disabled.
