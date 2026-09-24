# Phase 2 OAuth contract slice

Scope: `packages/oauth/**`, provider-only OAuth fixtures, and local evidence.

The implementation stores OAuth state as a hash, binds it to an organization and actor, enforces expiry and one-time claim, and returns a worker-only callback claim. Expiry converts both ISO inputs to parsed instants and fails closed on an unparseable value; it never relies on lexical timestamp ordering across valid timezone offsets. The safe attempt projection omits the state hash and callback code. The token exchange is an injected provider contract guarded by existing worker runtime capabilities; it performs no HTTP itself and was exercised only by deterministic fixtures.

The OAuth package does not import the worker secret-provider seam. Its exchange contract is capability-gated for `secret_provider` and `shopee_call`, while the package-boundary test additionally denies web imports of the exchange module and OAuth imports of `worker-secret-provider.ts`. `.gitignore` protects `.env`/`.env.*`, preserves `.env.example`, and excludes generated dependency/build output; it does not modify `.env`.

Grant normalization preserves the distinction between organization ownership, authorization grant, credential subject, and shop binding. A shared subject can bind multiple shops, while independent subjects stay distinct. Rotation keys on the credential subject revision; unknown rotation transitions fail closed to `reauth_required` rather than retrying any token.

Verification: `node --experimental-strip-types --test packages/oauth/src/oauth-contracts.test.ts packages/oauth/src/oauth-state-time.test.ts` passed 13/13, including equivalent UTC/+02:00 instant handling and malformed-date fail-closed behavior. `node --experimental-strip-types packages/oauth/src/manual-oauth.ts` emitted the JSON captured in `.artifacts/phase2/oauth/manual-oauth.json`. Direct `tsc` and `biome` command names are unavailable. `pnpm exec tsc --noEmit` attempted dependency setup and failed with managed-filesystem `ENOENT` while creating its `_tmp_*` install path, so repository-wide type/lint validation remains an explicit tooling gap.

No `.env` was read. No real credential, network call, cookie, browser automation, or external write was used.
