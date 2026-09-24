BEGIN;

CREATE TABLE catalog_collection_runs (
  collection_run_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  shop_id uuid NOT NULL,
  collected_at timestamptz NOT NULL,
  completeness text NOT NULL CHECK (completeness IN ('complete', 'incomplete')),
  incomplete_reason text CHECK (incomplete_reason IS NULL OR incomplete_reason IN ('missing_next_cursor', 'cursor_repeated', 'duplicate_product', 'malformed_page')),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  FOREIGN KEY (organization_id, shop_id)
    REFERENCES shop_connections (organization_id, id) ON DELETE RESTRICT,
  UNIQUE (collection_run_id, organization_id, shop_id),
  CHECK ((completeness = 'complete' AND incomplete_reason IS NULL)
    OR (completeness = 'incomplete' AND incomplete_reason IS NOT NULL))
);

CREATE TABLE catalog_products (
  collection_run_id uuid NOT NULL REFERENCES catalog_collection_runs (collection_run_id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL,
  shop_id uuid NOT NULL,
  product_id text NOT NULL CHECK (length(btrim(product_id)) > 0),
  product_name text NOT NULL CHECK (length(btrim(product_name)) > 0),
  publication text NOT NULL CHECK (publication IN ('active', 'inactive', 'unknown')),
  available_stock integer CHECK (available_stock IS NULL OR available_stock >= 0),
  PRIMARY KEY (collection_run_id, product_id),
  FOREIGN KEY (collection_run_id)
    REFERENCES catalog_collection_runs (collection_run_id) ON DELETE RESTRICT,
  FOREIGN KEY (collection_run_id, organization_id, shop_id)
    REFERENCES catalog_collection_runs (collection_run_id, organization_id, shop_id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, shop_id)
    REFERENCES shop_connections (organization_id, id) ON DELETE RESTRICT
);

CREATE TABLE catalog_variants (
  collection_run_id uuid NOT NULL,
  product_id text NOT NULL,
  organization_id uuid NOT NULL,
  shop_id uuid NOT NULL,
  variant_id text NOT NULL CHECK (length(btrim(variant_id)) > 0),
  variant_name text NOT NULL CHECK (length(btrim(variant_name)) > 0),
  available_stock integer CHECK (available_stock IS NULL OR available_stock >= 0),
  PRIMARY KEY (collection_run_id, product_id, variant_id),
  FOREIGN KEY (collection_run_id, product_id)
    REFERENCES catalog_products (collection_run_id, product_id) ON DELETE RESTRICT,
  FOREIGN KEY (collection_run_id, organization_id, shop_id)
    REFERENCES catalog_collection_runs (collection_run_id, organization_id, shop_id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, shop_id)
    REFERENCES shop_connections (organization_id, id) ON DELETE RESTRICT
);

CREATE INDEX catalog_collection_runs_scope_idx
  ON catalog_collection_runs (organization_id, shop_id, collected_at DESC);

COMMIT;
