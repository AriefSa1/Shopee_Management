BEGIN;

CREATE TABLE oauth_states (
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  state_hash text NOT NULL CHECK (state_hash ~ '^[a-z0-9-]{32,128}$'),
  attempt_id uuid NOT NULL,
  actor_issuer text NOT NULL CHECK (length(btrim(actor_issuer)) > 0),
  actor_subject text NOT NULL CHECK (length(btrim(actor_subject)) > 0),
  partner_application_id text NOT NULL CHECK (length(btrim(partner_application_id)) > 0),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('issued', 'claimed', 'expired')),
  claimed_at timestamptz,
  PRIMARY KEY (organization_id, state_hash),
  UNIQUE (organization_id, attempt_id),
  CHECK (expires_at > issued_at),
  CHECK ((status = 'issued' AND claimed_at IS NULL) OR (status IN ('claimed', 'expired')))
);

CREATE INDEX oauth_states_expiry_idx
  ON oauth_states (organization_id, expires_at)
  WHERE status = 'issued';

COMMIT;
