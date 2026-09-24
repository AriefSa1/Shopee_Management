# Phase 1 configuration and secret-scan boundary evidence

The provider-free configuration boundary now exposes four explicit runtime modes: web, worker, migration, and readonly-support. Migration requires a database URL in every environment; readonly-support follows the existing production database requirement; web and worker retain their service-specific host and port fields. Safe diagnostics return only the mode, status, and field names.

The static secret-scan contract reports only a path and rule for forbidden runtime environment access or credential identifiers. It never returns source text or matched values.

Fail-first proof:

`node --experimental-strip-types --test packages/config/src/runtime-config.test.ts packages/observability/src/secret-scan.test.ts` initially failed before implementation with missing exports/module (`getSafeConfigurationDiagnostics` and `secret-scan.ts`).

Focused verification:

`node --experimental-strip-types --test packages/config/src/runtime-config.test.ts packages/observability/src/secret-scan.test.ts packages/observability/src/safe-telemetry.test.ts packages/runtime-boundaries/src/runtime-boundaries.test.ts packages/runtime-boundaries/src/package-boundaries.test.ts` passed 22/22 tests, including a scan of the foundational package sources for runtime environment access and explicit migration/readonly-support credential denial.

Manual QA:

`node --experimental-strip-types packages/config/src/manual-security-config.ts` exited 0 and produced `.artifacts/phase1/security/manual-config-security.json`. The artifact records both new modes, safe invalid-field diagnostics, two metadata-only fixture findings, and zero network/database/Shopee mutations with no secret fields.

The remaining Phase 1 security gates are human review of the existing non-empty `.env`, live PostgreSQL role-denial checks, KMS integration, repository-wide typecheck/lint, and deployment validation. No credential value was read or printed and no external call was made.
