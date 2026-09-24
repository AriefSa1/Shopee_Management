BEGIN;

ALTER TABLE oauth_states
  ADD COLUMN market text;

ALTER TABLE oauth_states
  ADD CONSTRAINT oauth_states_market_format
  CHECK (market IS NULL OR market ~ '^[A-Z]{2}$');

CREATE TABLE oauth_exchange_commands (
  organization_id uuid NOT NULL,
  attempt_id uuid NOT NULL,
  state_hash text NOT NULL,
  partner_application_id text NOT NULL CHECK (length(btrim(partner_application_id)) > 0),
  market text NOT NULL CHECK (market ~ '^[A-Z]{2}$'),
  actor_issuer text NOT NULL CHECK (length(btrim(actor_issuer)) > 0),
  actor_subject text NOT NULL CHECK (length(btrim(actor_subject)) > 0),
  command_id uuid NOT NULL,
  event_id uuid NOT NULL,
  envelope_algorithm text NOT NULL CHECK (envelope_algorithm = 'kms-envelope-v1'),
  envelope_key_version integer NOT NULL CHECK (envelope_key_version > 0),
  envelope_ciphertext text NOT NULL CHECK (length(btrim(envelope_ciphertext)) > 0),
  status text NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, attempt_id),
  UNIQUE (organization_id, command_id),
  UNIQUE (organization_id, event_id),
  FOREIGN KEY (organization_id, state_hash)
    REFERENCES oauth_states (organization_id, state_hash),
  FOREIGN KEY (organization_id, command_id)
    REFERENCES delivery_commands (organization_id, command_id),
  FOREIGN KEY (organization_id, event_id)
    REFERENCES outbox_events (organization_id, event_id)
);

CREATE INDEX oauth_exchange_commands_pending_idx
  ON oauth_exchange_commands (organization_id, created_at)
  WHERE status = 'pending';

COMMIT;
