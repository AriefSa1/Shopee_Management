BEGIN;

CREATE TABLE staging_feature_flags (
  organization_id uuid NOT NULL,
  shop_id uuid NOT NULL,
  environment text NOT NULL CHECK (environment = 'staging'),
  write_pilot_enabled boolean NOT NULL,
  official_product_write text NOT NULL CHECK (official_product_write IN ('verified', 'unknown', 'denied')),
  media_lifecycle text NOT NULL CHECK (media_lifecycle IN ('verified', 'unknown', 'denied')),
  item_correlation text NOT NULL CHECK (item_correlation IN ('verified', 'unknown', 'denied')),
  variation_atomicity text NOT NULL CHECK (variation_atomicity IN ('verified', 'unknown', 'denied')),
  safe_recovery text NOT NULL CHECK (safe_recovery IN ('verified', 'unknown', 'denied')),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, shop_id),
  FOREIGN KEY (organization_id, shop_id)
    REFERENCES shop_connections (organization_id, id) ON DELETE RESTRICT
);

CREATE TABLE staging_reconciliation_snapshots (
  organization_id uuid NOT NULL,
  shop_id uuid NOT NULL,
  collected_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('clean', 'mismatch', 'unavailable')),
  expected_destination_count integer NOT NULL CHECK (expected_destination_count >= 0),
  observed_destination_count integer NOT NULL CHECK (observed_destination_count >= 0),
  PRIMARY KEY (organization_id, shop_id),
  FOREIGN KEY (organization_id, shop_id)
    REFERENCES shop_connections (organization_id, id) ON DELETE RESTRICT,
  CHECK (status <> 'clean' OR expected_destination_count = observed_destination_count)
);

CREATE INDEX staging_reconciliation_recent_idx
  ON staging_reconciliation_snapshots (organization_id, collected_at DESC);

COMMIT;
