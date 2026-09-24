BEGIN;

CREATE TABLE write_commands (
  organization_id uuid NOT NULL,
  command_id text NOT NULL,
  actor_id text NOT NULL CHECK (length(btrim(actor_id)) > 0),
  intent_id text NOT NULL CHECK (length(btrim(intent_id)) > 0),
  preview_hash text NOT NULL CHECK (preview_hash ~ '^[0-9a-f]{64}$'),
  command_version integer NOT NULL CHECK (command_version > 0),
  capability_status text NOT NULL CHECK (capability_status IN ('verified', 'unknown', 'denied')),
  capability_evidence text NOT NULL CHECK (length(btrim(capability_evidence)) > 0),
  confirmation_binding text NOT NULL CHECK (confirmation_binding ~ '^[0-9a-f]{64}$'),
  plan_kind text NOT NULL CHECK (plan_kind IN ('write_disabled', 'ready')),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (organization_id, command_id),
  FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE RESTRICT
);

CREATE TABLE write_attempts (
  organization_id uuid NOT NULL,
  attempt_id text NOT NULL,
  command_id text NOT NULL,
  destination_shop_id uuid NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  state text NOT NULL CHECK (state IN ('pending', 'dispatched', 'succeeded', 'failed', 'outcome_unknown', 'reauth_required')),
  dispatch_allowed boolean NOT NULL,
  confirmation_binding text NOT NULL CHECK (confirmation_binding ~ '^[0-9a-f]{64}$'),
  outcome_reason text,
  provider_reference text,
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (organization_id, attempt_id),
  FOREIGN KEY (organization_id, command_id)
    REFERENCES write_commands (organization_id, command_id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, destination_shop_id)
    REFERENCES shop_connections (organization_id, id) ON DELETE RESTRICT,
  UNIQUE (organization_id, command_id, destination_shop_id),
  CHECK (state IN ('pending', 'dispatched') OR dispatch_allowed = false),
  CHECK (state <> 'outcome_unknown' OR provider_reference IS NULL)
);

CREATE TABLE write_recovery_decisions (
  decision_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  attempt_id text NOT NULL,
  decision_kind text NOT NULL CHECK (decision_kind IN ('reauthenticate', 'mark_failed', 'confirm_succeeded')),
  operator_id text NOT NULL CHECK (length(btrim(operator_id)) > 0),
  decided_at timestamptz NOT NULL,
  reason text,
  provider_reference text,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  FOREIGN KEY (organization_id, attempt_id)
    REFERENCES write_attempts (organization_id, attempt_id) ON DELETE RESTRICT,
  CHECK ((decision_kind = 'confirm_succeeded' AND provider_reference IS NOT NULL AND reason IS NULL)
    OR (decision_kind = 'mark_failed' AND reason IS NOT NULL AND provider_reference IS NULL)
    OR (decision_kind = 'reauthenticate' AND reason IS NULL AND provider_reference IS NULL))
);

CREATE FUNCTION deny_write_recovery_decision_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'write_recovery_decisions is append-only';
END;
$$;

CREATE TRIGGER write_recovery_decisions_no_update
  BEFORE UPDATE OR DELETE ON write_recovery_decisions
  FOR EACH ROW EXECUTE FUNCTION deny_write_recovery_decision_mutation();

CREATE INDEX write_attempts_scope_state_idx
  ON write_attempts (organization_id, destination_shop_id, state, updated_at DESC);

COMMIT;
