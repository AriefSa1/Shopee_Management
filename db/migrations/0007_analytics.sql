BEGIN;

CREATE TABLE analytics_collection_runs (
  collection_run_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  shop_id uuid NOT NULL,
  metric_definition_id text NOT NULL CHECK (length(btrim(metric_definition_id)) > 0),
  metric_version integer NOT NULL CHECK (metric_version > 0),
  metric_unit text NOT NULL CHECK (metric_unit IN ('count', 'score', 'percentage')),
  metric_window text NOT NULL CHECK (metric_window IN ('rolling_30_days', 'cumulative')),
  metric_capability text NOT NULL CHECK (metric_capability IN ('enabled', 'unsupported')),
  requested_product_ids jsonb NOT NULL CHECK (jsonb_typeof(requested_product_ids) = 'array'),
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL,
  as_of_min timestamptz,
  as_of_max timestamptz,
  freshness_tolerance_minutes integer NOT NULL CHECK (freshness_tolerance_minutes >= 0),
  expected_pages integer NOT NULL CHECK (expected_pages >= 0),
  observed_pages integer NOT NULL CHECK (observed_pages >= 0 AND observed_pages <= expected_pages),
  expected_items integer NOT NULL CHECK (expected_items >= 0),
  observed_items integer NOT NULL CHECK (observed_items >= 0 AND observed_items <= expected_items),
  cursor_evidence text NOT NULL CHECK (cursor_evidence IN ('complete', 'missing_page', 'cursor_repeated', 'response_mismatch', 'incompatible_capability', 'invalid_collection')),
  status text NOT NULL CHECK (status IN ('complete', 'partial', 'failed')),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  FOREIGN KEY (organization_id, shop_id)
    REFERENCES shop_connections (organization_id, id) ON DELETE RESTRICT,
  UNIQUE (collection_run_id, organization_id, shop_id),
  CHECK (finished_at >= started_at),
  CHECK ((status = 'complete' AND observed_pages = expected_pages)
    OR status IN ('partial', 'failed'))
);

CREATE TABLE analytics_metric_snapshots (
  collection_run_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  shop_id uuid NOT NULL,
  product_id text NOT NULL CHECK (length(btrim(product_id)) > 0),
  metric_definition_id text NOT NULL CHECK (length(btrim(metric_definition_id)) > 0),
  metric_version integer NOT NULL CHECK (metric_version > 0),
  metric_unit text NOT NULL CHECK (metric_unit IN ('count', 'score', 'percentage')),
  metric_window text NOT NULL CHECK (metric_window IN ('rolling_30_days', 'cumulative')),
  metric_capability text NOT NULL CHECK (metric_capability IN ('enabled', 'unsupported')),
  state text NOT NULL CHECK (state IN ('value', 'missing', 'unsupported', 'not_returned')),
  value numeric CHECK (value IS NULL OR value >= 0),
  collected_at timestamptz NOT NULL,
  as_of timestamptz NOT NULL,
  PRIMARY KEY (collection_run_id, product_id),
  FOREIGN KEY (collection_run_id, organization_id, shop_id)
    REFERENCES analytics_collection_runs (collection_run_id, organization_id, shop_id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, shop_id)
    REFERENCES shop_connections (organization_id, id) ON DELETE RESTRICT,
  CHECK ((state = 'value' AND value IS NOT NULL AND metric_capability = 'enabled')
    OR (state IN ('missing', 'not_returned') AND value IS NULL AND metric_capability = 'enabled')
    OR (state = 'unsupported' AND value IS NULL AND metric_capability = 'unsupported'))
);

CREATE INDEX analytics_collection_runs_scope_idx
  ON analytics_collection_runs (organization_id, shop_id, finished_at DESC);

CREATE INDEX analytics_metric_snapshots_product_idx
  ON analytics_metric_snapshots (organization_id, shop_id, product_id, as_of DESC);

COMMIT;
