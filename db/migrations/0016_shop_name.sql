BEGIN;

-- Human-readable shop name from Shopee get_shop_info, populated by the worker at
-- OAuth exchange time. Nullable: existing rows stay null until the next
-- authorization, and the UI falls back to the external shop id.
ALTER TABLE shop_connections
  ADD COLUMN shop_name text;

COMMIT;
