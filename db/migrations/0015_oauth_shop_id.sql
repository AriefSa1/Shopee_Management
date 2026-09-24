BEGIN;

ALTER TABLE oauth_exchange_commands
  ADD COLUMN shop_id text,
  ADD CONSTRAINT oauth_exchange_commands_shop_id_format
    CHECK (shop_id IS NULL OR shop_id ~ '^[1-9][0-9]*$');

COMMIT;
