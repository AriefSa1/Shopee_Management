BEGIN;

CREATE TABLE external_operation_attempts (
  organization_id uuid NOT NULL,
  operation_attempt_id text NOT NULL,
  write_attempt_id text NOT NULL,
  destination_shop_id uuid NOT NULL,
  step text NOT NULL CHECK (step IN ('media_upload', 'item_create', 'variation_init', 'publication')),
  request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  state text NOT NULL CHECK (state IN ('prepared', 'sent', 'succeeded', 'failed', 'outcome_unknown', 'reauth_required')),
  retry_allowed boolean NOT NULL,
  outcome_reason text,
  provider_reference text,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (organization_id, operation_attempt_id),
  FOREIGN KEY (organization_id, write_attempt_id)
    REFERENCES write_attempts (organization_id, attempt_id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, destination_shop_id)
    REFERENCES shop_connections (organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, write_attempt_id, step),
  CHECK ((state = 'prepared' AND retry_allowed = true) OR (state <> 'prepared' AND retry_allowed = false)),
  CHECK (state <> 'outcome_unknown' OR provider_reference IS NULL),
  CHECK (state <> 'succeeded' OR provider_reference IS NOT NULL)
);

CREATE INDEX external_operation_attempts_scope_state_idx
  ON external_operation_attempts (organization_id, state, updated_at DESC);

COMMIT;
