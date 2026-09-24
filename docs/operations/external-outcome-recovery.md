# External Outcome Recovery

Purpose: prosedur evidence-based untuk external call yang mungkin sudah diterima Shopee. Status: required before write. Owner: Domain/Ops/Shopee Lead. Approval gate: pre-write gate.

Related: [copy state machine](../requirements/copy-product-state-machine.md), [integration contracts](../architecture/integration-contracts.md), [runbooks](runbooks.md), [rollback](rollback.md).

## Classification

Setiap mutation memiliki attempt UUID, operation type, command/intent, credential subject, request fingerprint, timestamps, dan state. Timeout, lost response, worker death after send, atau DB failure sebelum resource ID durable => `OUTCOME_UNKNOWN`.

## Resolution order

1. Pause automatic retry and dispatch for that logical intent/destination.
2. Search durable local mapping and official upstream correlation/idempotency/lookup if documented and authorized.
3. If evidence proves success, persist mapping and continue only from the definitely incomplete safe step.
4. If evidence proves absence, record proof and create a new approved attempt only after authorization/confirmation policy is satisfied.
5. If unresolved, keep `OUTCOME_UNKNOWN`, escalate to Owner/Shopee operator, and never resend blindly.

An attempt that may have reached Shopee is never marked cancelled merely because rollback started. Preserve audit and evidence through retention.

