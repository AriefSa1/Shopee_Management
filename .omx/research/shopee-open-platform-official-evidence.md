# Shopee Open Platform Official Evidence

Research date: 2026-09-09 Asia/Jakarta.

## Direct Recommendation

Use the official Shopee Open Platform seller authorization flow, keep credentials and tokens server-only, create one connection record per `shop_id`, refresh tokens independently per shop, and treat every write as a validated job with preview and explicit user confirmation.

## Evidence

- The platform introduction states that Open APIs cover products and product optimization and are available across markets: https://open.shopee.com/developer-guide/4
- Authorization requires seller approval for non-public shop-management APIs. The current documented flow uses `https://open.shopee.com/auth` with `partner_id`, `auth_type=seller`, `redirect_uri`, `response_type=code`, and optional anti-CSRF `state`: https://open.shopee.com/developer-guide/20
- A shop account authorizes one shop; a main account can authorize multiple shops. The callback returns either `shop_id` or `main_account_id`, and token exchange can return `shop_id_list`.
- Authorization can last at most 365 days. Access tokens are documented as valid for four hours and refresh tokens for 30 days. New refresh tokens replace previous ones and must be stored per shop/merchant.
- Product creation preparation requires shop-specific leaf categories, mandatory attributes, brand options, item limits, shipping constraints, and logistics channels: https://open.shopee.com/developer-guide/209
- Product media must be uploaded to Shopee MediaSpace before `v2.product.add_item`; products require leaf category IDs and mandatory attributes, with variants created through `v2.product.init_tier_variation`: https://open.shopee.com/developer-guide/211
- `v2.product.get_item_list`, `get_item_base_info`, `get_model_list`, and `get_item_extra_info` support centralized catalog and analytics. Documented extra metrics include views over the last 30 days plus cumulative sales, likes, ratings, and star rating: https://open.shopee.com/developer-guide/221

## Planning Boundaries

- The product base information guide is older than the authorization and creation guides. Endpoint fields, quotas, regional behavior, and app permissions must be revalidated in the user's Open Platform Console during implementation.
- Analytics must expose only metrics available to the authorized app. Do not promise impressions, conversion, or profit metrics unless confirmed by an approved endpoint.
- Never use Seller Centre cookies or undocumented browser automation as a fallback.

