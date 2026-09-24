# Execution-Ready Specification: Shopee Multi-Store Product Management

## Metadata

- Profile: Standard deep interview
- Context: Greenfield
- Rounds: 10
- Final ambiguity: 0.08
- Threshold: 0.20
- Context snapshot: `.omx/context/shopee-multi-store-management-20260908T172043Z.md`
- Transcript: `.omx/interviews/shopee-multi-store-management-20260908T172043Z.md`
- Official research: `.omx/research/shopee-open-platform-official-evidence.md`

## Intent

Provide one internal dashboard that lets a business manage product operations across several Shopee shops, reducing repetitive Seller Centre work and freeing the team for higher-value tasks.

## Desired Outcome

After a 30-day pilot, time spent on comparable cross-shop product-management work is at least 50% lower than the recorded baseline.

## Users and Context

- One business/organization.
- Multiple Shopee shops.
- Multiple internal users with Owner, Admin, and Staff roles.
- Official Shopee Open Platform authorization only.

## MVP Scope

### 1. Centralized Product Catalog

- Connect and display products from every authorized shop.
- Filter and search by shop, status, category, SKU, stock state, and synchronization state.
- Show base information and variants without exposing credentials.
- Show last successful sync and actionable sync errors.

### 2. Product Performance Analytics

- Display only metrics available through approved official endpoints.
- Initial confirmed metrics: views for the last 30 days, cumulative sales, likes, ratings, and star rating.
- Compare products and shops over a selected supported period.
- Surface data freshness and distinguish current snapshots from historical series collected by the app.

### 3. Copy Products Between Shops

- Select a source product and one or more destination shops.
- Fetch destination-shop category, attribute, brand, limits, and logistics requirements.
- Map source data to a valid destination payload.
- Upload media to Shopee MediaSpace as required.
- Present a per-shop preview with validation status and editable required fields.
- Publish valid listings only after explicit bulk confirmation.
- Keep invalid listings unpublished and show field-level reasons.
- Track each destination as an independent idempotent job with audit history.

## Non-Goals

- Orders and fulfillment.
- Customer chat.
- Ads, campaigns, vouchers, and promotions.
- Accounting, profit/loss, and payment reconciliation.
- Warehouse or other marketplace integrations.
- Automatic real-time inventory synchronization.
- General-purpose bulk editing.
- AI-generated product content.
- Autonomous listing changes without user approval.
- Native mobile apps.
- Public SaaS signup, subscription billing, and multi-company tenancy.

## Decision Boundaries

The planner may decide the recommended stack, architecture, database, API structure, role permissions, synchronization strategy, security controls, UX flows, testing, observability, and deployment within this scope. User confirmation is still required for scope expansion, significant external cost, real credential use, production deployment, and destructive data operations.

## Constraints

- No cookie-based Shopee connection or fallback.
- Partner keys, tokens, OAuth state, authorization headers, and raw credentials remain server-only and must not appear in client responses or logs.
- Shop access is organization-scoped and every operation must verify both user permission and shop ownership.
- Tokens are stored per shop and refreshed with rotation-safe locking.
- Write operations require preview and explicit confirmation.
- API rate limits, endpoint permissions, regional rules, and field requirements are treated as dynamic external constraints.
- The responsive web UI is desktop-first but usable on tablet and mobile browsers.

## Acceptance Criteria

1. An Owner can authorize multiple shops through the official flow and every returned shop is stored as a distinct connection.
2. No client payload, UI, or application log contains partner keys, access tokens, refresh tokens, OAuth state secrets, or authorization headers.
3. Authorized users can browse a combined catalog and filter it by shop, status, category, SKU, stock state, and sync state.
4. Product details correctly show base information and variants for their owning shop.
5. Analytics labels metric definition and freshness; unavailable metrics are not fabricated.
6. A user can select one product and multiple destination shops, receive independent validation results, preview all mapped fields, and explicitly confirm publication.
7. A failed destination never blocks valid destinations and never creates an unreviewed listing.
8. Retrying a copy job does not create duplicate listings for destinations already completed.
9. Owner, Admin, and Staff permissions are enforced server-side for every protected action.
10. Every shop connection, sync, validation, confirmation, publication result, and role-sensitive action emits an audit event without secret values.
11. The 30-day pilot records a baseline and demonstrates at least 50% lower time for the same cross-shop product-management workflow and shop count.

## Assumptions and Resolutions

- Product performance is limited to official data accessible to the app; unsupported conversion/profit metrics are excluded.
- Copy means create a new destination listing, not link stock or keep fields synchronized after publication.
- Partial success is allowed per destination shop, but every result is visible and retryable.
- The system is single-organization at MVP, but organization IDs remain explicit in the data model to prevent unsafe global queries.

## Scenario Pressure Result

If a source product is copied to ten shops and three fail destination validation, the user sees ten previews, confirms only valid payloads, seven jobs may publish, three remain unpublished with field-level errors, and retrying after corrections does not duplicate the seven completed listings.

## Technical Findings

- Authorization guide: https://open.shopee.com/developer-guide/20
- Product preparation guide: https://open.shopee.com/developer-guide/209
- Product creation guide: https://open.shopee.com/developer-guide/211
- Product information guide: https://open.shopee.com/developer-guide/221
- Exact endpoint permissions and rate limits remain an implementation-time verification gate in the user's Open Platform Console.

