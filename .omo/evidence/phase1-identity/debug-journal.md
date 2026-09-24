# Debug Journal: manual RBAC CLI hang

Started: 2026-09-09T05:15:00Z
Goal: make the manual RBAC entrypoint terminate and write its required artifact.

## Environment

- Runtime: Node 24.16.0 with `--experimental-strip-types`, ESM.
- Repro: `node --experimental-strip-types packages/identity/src/manual-rbac.ts` produces no stdout or artifact before the runner timeout.
- Control: the same loader finishes all identity and audit Node tests.
- References: Node runtime, setup, and investigate references from `omo:debugging`.

## Hypotheses

1. Domain promises do not settle. Distinguishing evidence: a minimal `authorize` invocation either terminates or hangs.
2. Import or strip-types loading stalls on the manual module graph. Distinguishing evidence: importing the domain modules alone either terminates or hangs.
3. The filesystem promise stalls before the artifact write. Distinguishing evidence: an isolated write into the owned artifact directory either terminates or hangs.

## Artifacts

- The required `.artifacts/phase1/identity/manual-rbac.json` is the only planned filesystem output; no debugger statement, inspector port, environment override, or temporary fixture is created.

## Findings

- Initial combined and isolated manual invocations both timed out with empty stdout and no artifact.

## Investigation round 1 (2026-09-09)

- H1 domain promises do not settle: test each top-level phase around scenario execution and decision promises.
- H2 manual module graph stalls: imports of model, permissions, boundary, and authorize each terminate; only manual-rbac stalls.
- H3 filesystem write stalls: place phase markers before and after the write preparation and write operation.
- Temporary instrumentation is journaled here and must be removed before completion; no external resource or credential is used.

### Investigation findings

- `node --experimental-strip-types -e` imports for model, permissions, boundary, and authorize all exit 0; only the manual entrypoint stalls.
- Temporary phase markers observed: `manual:before-scenarios`, `manual:after-scenarios`, `manual:after-asserts`, `manual:before-mkdir`; no marker after the promise-based mkdir.
- After precreating the directory with an evidence-only placeholder, the same entrypoint advanced past mkdir but `writeFile` returned `ENOENT`, confirming the promise-based filesystem boundary is the unstable step in this managed workspace.
- Fix hypothesis: use synchronous mkdir/write operations for this finite, local deterministic evidence entrypoint; this removes the unresolved promise at the manual surface while leaving authorization logic unchanged.
