# Integration Contracts

Purpose: menetapkan boundary antara domain, worker, dan Shopee adapter tanpa mengarang capability. Status: approved contract shape; endpoint/permission details are capability-gated. Owner: Domain/Shopee Integration Lead. Approval gate: per adapter phase and pre-write.

Official references: [authorization](https://open.shopee.com/developer-guide/20), [product preparation](https://open.shopee.com/developer-guide/209), [product creation](https://open.shopee.com/developer-guide/211), [product information](https://open.shopee.com/developer-guide/221).

## Adapter boundaries

- **OAuth adapter** accepts validated state/code envelope and returns grant/subject/shop evidence; it never returns raw token to web.
- **Catalog adapter** reads paginated product/base/model/approved extra information and returns safe DTOs plus cursor/completeness evidence. Official guide names `v2.product.get_item_list`, `get_item_base_info`, `get_model_list`, and `get_item_extra_info`; exact permission/fields remain [UNKNOWN](../requirements/shopee-capability-matrix.md).
- **Requirement adapter** reads destination-specific leaf category, mandatory attributes, brands, limits, logistics, shipping, and media requirements.
- **Mutation adapter** is disabled until pre-write gate. After confirmation only, it may perform MediaSpace upload, add-item, and verified variation steps. Official creation guide names `v2.product.add_item` and `v2.product.init_tier_variation`; visibility/correlation/atomicity remain gates.

## Common contract

Every call receives resolved `organization_id`, shop connection, credential subject, market, capability version, request correlation ID, and limiter context. Adapter returns redacted response, upstream request fingerprint, safe error class, observed headers/codes, and resource/correlation IDs when officially available. Raw secrets and authorization headers never cross the domain/web boundary.

## Failure contract

Classify errors as definite validation, definite authorization, definite transient, rate limited, revoked, or `OUTCOME_UNKNOWN`. Only definite transient/rate-limit may retry under limiter/backoff policy. Possible-sent mutation never retries blindly; see [recovery](../operations/external-outcome-recovery.md).

The provider-free `HierarchicalRateLimiter` contract in `packages/integrations/src/rate-limit.ts` evaluates partner/global, credential-subject, shop, and endpoint scopes in that order. A missing or `unknown` scope denies admission conservatively; a verified scope uses a bounded fixed window, and a provider `Retry-After` observation creates a local cooldown. The contract carries identifiers only and never stores partner keys, tokens, headers, or raw provider payloads.

## Capability contract

Adapter enablement requires market, app permission, field schema, pagination, rate scope, media lifecycle, visibility, variation safety, and ambiguity recovery evidence. Missing evidence returns `UNSUPPORTED`/`UNSUPPORTED_SHAPE` locally and makes no mutation.
