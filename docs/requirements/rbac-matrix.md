# RBAC Matrix

Purpose: menetapkan permission synchronous dan asynchronous. Status: approved baseline. Owner: Product/Security. Approval gate: Phase 1; revalidated before Phase 5/6 dispatch.

Related: [PRD](PRD.md), [copy state machine](copy-product-state-machine.md), [threat model](../security/threat-model.md), [data model](../architecture/data-model.md).

| Action | Owner | Admin | Staff | Async revalidation |
| --- | --- | --- | --- | --- |
| Read catalog/analytics/safe status | Ya | Ya | Ya | Org + shop ownership + active membership |
| Create/edit/validate local preview | Ya | Ya | Ya | Org + source/destination ownership + command hash |
| Confirm/publish | Ya | Ya | Tidak | Membership, publication permission, hashes, policy/feature revision |
| Manual catalog/metric sync | Ya | Ya | Tidak | Membership + connection/grant/binding + capability |
| Authorize/reauthorize/disconnect shop | Ya | Tidak | Tidak | Owner membership + OAuth state/connection status |
| Manage membership/role/settings | Ya | Tidak | Tidak | Owner membership + authz revision |
| Full audit/export | Ya | Read-only safe | Tidak | Scope and redaction policy |
| Replay DLQ/recovery decision | Ya | Dengan approval policy | Tidak | Owner/Admin active + immutable command + evidence |

Server-side authorization wajib memeriksa `organization_id`, active membership, role, shop ownership, grant/binding, connection status, feature flag, policy revision, command hash, supported shape, dan unresolved/terminal attempt. UI hiding bukan kontrol keamanan.

Revocation sebelum first mutation membatalkan dispatch dengan exact hold state. Revocation setelah possible send tidak menghapus history atau melakukan cancel/resend; masuk recovery.

