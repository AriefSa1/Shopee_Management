BEGIN;

CREATE TABLE copy_previews (
  organization_id uuid NOT NULL,
  preview_hash text NOT NULL CHECK (preview_hash ~ '^[0-9a-f]{64}$'),
  source_snapshot_id text NOT NULL,
  requirement_snapshot_id text NOT NULL,
  destination_shop_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('valid', 'invalid')),
  title text,
  description text,
  category_id text,
  attributes jsonb,
  errors jsonb,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (organization_id, preview_hash),
  UNIQUE (organization_id, destination_shop_id, preview_hash),
  FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, destination_shop_id)
    REFERENCES shop_connections (organization_id, id) ON DELETE RESTRICT,
  CHECK ((kind = 'valid' AND title IS NOT NULL AND description IS NOT NULL AND category_id IS NOT NULL AND errors IS NULL)
    OR (kind = 'invalid' AND title IS NULL AND description IS NULL AND category_id IS NULL AND errors IS NOT NULL))
);

CREATE TABLE copy_intents (
  organization_id uuid NOT NULL,
  copy_intent_id text NOT NULL,
  source_snapshot_id text NOT NULL,
  destination_shop_id uuid NOT NULL,
  active_preview_hash text NOT NULL,
  command_version integer NOT NULL CHECK (command_version > 0),
  serialization_generation integer NOT NULL CHECK (serialization_generation > 0),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (organization_id, copy_intent_id),
  FOREIGN KEY (organization_id, destination_shop_id)
    REFERENCES shop_connections (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, destination_shop_id, active_preview_hash)
    REFERENCES copy_previews (organization_id, destination_shop_id, preview_hash) ON DELETE RESTRICT
);

CREATE INDEX copy_previews_destination_idx
  ON copy_previews (organization_id, destination_shop_id, created_at DESC);

COMMIT;
