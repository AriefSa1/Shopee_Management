# Threat Model

Purpose: mengidentifikasi ancaman dan kontrol untuk dashboard internal. Status: approved baseline; final pre-production review required. Owner: Security Lead. Approval gate: Phase 1 initial, pre-production final.

Related: [secret handling](secret-handling.md), [RBAC](../requirements/rbac-matrix.md), [copy state machine](../requirements/copy-product-state-machine.md), [runbooks](../operations/runbooks.md).

| Threat | Control | Evidence gate |
| --- | --- | --- |
| OAuth replay/CSRF/substitution | One-time hashed state, redirect binding, expiry, recent auth for sensitive changes | Phase 2 tests |
| Credential-subject confusion | Separate grant/subject/shop binding, subject lock/revision, ownership checks | Phase 2 tests |
| IDOR/cross-org shop access | Composite scope constraints and server-side authz | Phase 1/2 tests |
| Secret leakage | Server-only secrets, local AES-GCM envelope encryption, allowlist logs, canaries | Phase 1/2 scan |
| Queue/command tampering | Immutable commands, hashes, fencing, authz at dispatch | Phase 5/6 tests |
| Duplicate or incomplete listing | Preview confirmation, supported-shape gate, durable attempts, no blind retry | Pre-write tests |
| SSRF/media abuse | Allowlisted Shopee hosts, redirect/content-type/size/private-network checks | Mutation adapter review |
| XSS/CSRF/session theft | HTTP-only same-site session, CSRF defense, CSP/security headers | Web security test |
| Privilege escalation/revocation race | Role revision and async revalidation; recovery after possible send | E2E tests |
| False analytics | Capability/completeness/as-of semantics and absence states | Phase 4 tests |

Alert if `pre_confirmation_shopee_mutation_total` is non-zero, encryption/DB deny test fails, secret scan finds a canary, or `OUTCOME_UNKNOWN` age exceeds operator threshold.
