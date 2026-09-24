BEGIN;

CREATE TABLE organizations (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

CREATE TABLE users (
  id uuid PRIMARY KEY,
  oidc_issuer text NOT NULL CHECK (length(btrim(oidc_issuer)) > 0),
  oidc_subject text NOT NULL CHECK (length(btrim(oidc_subject)) > 0),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (oidc_issuer, oidc_subject)
);

CREATE TABLE memberships (
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'staff')),
  status text NOT NULL CHECK (status IN ('active', 'revoked')),
  authz_revision bigint NOT NULL CHECK (authz_revision > 0),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  revoked_at timestamptz,
  PRIMARY KEY (organization_id, user_id),
  UNIQUE (organization_id, user_id, authz_revision),
  CHECK (
    (status = 'active' AND revoked_at IS NULL)
    OR (status = 'revoked' AND revoked_at IS NOT NULL)
  )
);

CREATE TABLE shop_connections (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  partner_application_id uuid NOT NULL,
  market text NOT NULL CHECK (market ~ '^[A-Z]{2}$'),
  external_shop_id text NOT NULL CHECK (length(btrim(external_shop_id)) > 0),
  status text NOT NULL CHECK (status IN ('active', 'disconnected')),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  disconnected_at timestamptz,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, partner_application_id, market, external_shop_id),
  CHECK (
    (status = 'active' AND disconnected_at IS NULL)
    OR (status = 'disconnected' AND disconnected_at IS NOT NULL)
  )
);

CREATE TABLE audit_events (
  event_id uuid PRIMARY KEY,
  version smallint NOT NULL CHECK (version = 1),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  event_kind text NOT NULL CHECK (
    event_kind IN ('authorization_decision', 'membership_changed', 'shop_connection_changed')
  ),
  permission_code text,
  decision_code text CHECK (decision_code IN ('allow', 'deny')),
  reason_code text,
  target_user_id uuid,
  target_role text CHECK (target_role IN ('owner', 'admin', 'staff')),
  authz_revision bigint CHECK (authz_revision > 0),
  shop_id uuid,
  action_code text,
  result_code text,
  UNIQUE (event_id, organization_id),
  FOREIGN KEY (organization_id, actor_user_id)
    REFERENCES memberships (organization_id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, shop_id)
    REFERENCES shop_connections (organization_id, id) ON DELETE RESTRICT,
  CHECK (reason_code IS NULL OR reason_code ~ '^[a-z][a-z0-9_]*$'),
  CHECK (result_code IS NULL OR result_code ~ '^[a-z][a-z0-9_]*$'),
  CHECK (
    (event_kind = 'authorization_decision'
      AND permission_code IS NOT NULL
      AND decision_code IS NOT NULL
      AND reason_code IS NOT NULL
      AND target_user_id IS NULL
      AND target_role IS NULL
      AND authz_revision IS NULL
      AND shop_id IS NULL
      AND action_code IS NULL
      AND result_code IS NULL)
    OR (event_kind = 'membership_changed'
      AND permission_code IS NULL
      AND decision_code IS NULL
      AND reason_code IS NULL
      AND target_user_id IS NOT NULL
      AND target_role IS NOT NULL
      AND authz_revision IS NOT NULL
      AND shop_id IS NULL
      AND action_code IS NULL
      AND result_code IS NOT NULL)
    OR (event_kind = 'shop_connection_changed'
      AND permission_code IS NULL
      AND decision_code IS NULL
      AND reason_code IS NULL
      AND target_user_id IS NULL
      AND target_role IS NULL
      AND authz_revision IS NULL
      AND shop_id IS NOT NULL
      AND action_code IS NOT NULL
      AND result_code IS NOT NULL)
  )
);

CREATE TABLE audit_event_shops (
  event_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  shop_id uuid NOT NULL,
  PRIMARY KEY (event_id, shop_id),
  FOREIGN KEY (event_id, organization_id)
    REFERENCES audit_events (event_id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, shop_id)
    REFERENCES shop_connections (organization_id, id) ON DELETE RESTRICT
);

CREATE FUNCTION reject_non_authorization_audit_event_shop()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  event_kind_value text;
BEGIN
  SELECT event_kind
    INTO event_kind_value
    FROM audit_events
   WHERE event_id = NEW.event_id
     AND organization_id = NEW.organization_id;
  IF event_kind_value IS DISTINCT FROM 'authorization_decision' THEN
    RAISE EXCEPTION 'audit_event_shops only supports authorization_decision events';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER audit_event_shops_authorization_only
BEFORE INSERT ON audit_event_shops
FOR EACH ROW EXECUTE FUNCTION reject_non_authorization_audit_event_shop();

CREATE FUNCTION reject_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'audit_events are append-only';
END;
$function$;

CREATE TRIGGER audit_events_no_update_or_delete
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION reject_audit_event_mutation();

CREATE FUNCTION reject_audit_event_shop_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'audit_event_shops are append-only';
END;
$function$;

CREATE TRIGGER audit_event_shops_no_update_or_delete
BEFORE UPDATE OR DELETE ON audit_event_shops
FOR EACH ROW EXECUTE FUNCTION reject_audit_event_shop_mutation();

COMMIT;
