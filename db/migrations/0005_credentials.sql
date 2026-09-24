BEGIN;

CREATE TABLE credential_subjects (
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  credential_subject_id uuid NOT NULL,
  partner_application_id text NOT NULL CHECK (length(btrim(partner_application_id)) > 0),
  revision bigint NOT NULL CHECK (revision > 0),
  key_version integer NOT NULL CHECK (key_version > 0),
  envelope_algorithm text NOT NULL CHECK (envelope_algorithm = 'kms-envelope-v1'),
  envelope_ciphertext text NOT NULL CHECK (length(btrim(envelope_ciphertext)) > 0),
  expires_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'reauth_required')),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (organization_id, credential_subject_id)
);

CREATE TABLE shop_credential_bindings (
  organization_id uuid NOT NULL,
  shop_id uuid NOT NULL,
  credential_subject_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'reauth_required')),
  bound_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (organization_id, shop_id, credential_subject_id),
  FOREIGN KEY (organization_id, shop_id)
    REFERENCES shop_connections (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, credential_subject_id)
    REFERENCES credential_subjects (organization_id, credential_subject_id) ON DELETE RESTRICT
);

CREATE FUNCTION validate_shop_credential_binding()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  subject_partner_application text;
  shop_partner_application text;
  shop_status text;
BEGIN
  SELECT partner_application_id
    INTO subject_partner_application
    FROM credential_subjects
   WHERE organization_id = NEW.organization_id
     AND credential_subject_id = NEW.credential_subject_id;
  SELECT partner_application_id::text, status
    INTO shop_partner_application, shop_status
    FROM shop_connections
   WHERE organization_id = NEW.organization_id
     AND id = NEW.shop_id;
  IF shop_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'credential binding requires an active shop connection';
  END IF;
  IF shop_partner_application IS DISTINCT FROM subject_partner_application THEN
    RAISE EXCEPTION 'credential binding partner application mismatch';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM shop_credential_bindings AS existing_binding
      JOIN shop_connections AS existing_shop
        ON existing_shop.organization_id = existing_binding.organization_id
       AND existing_shop.id = existing_binding.shop_id
     WHERE existing_binding.organization_id = NEW.organization_id
       AND existing_binding.credential_subject_id = NEW.credential_subject_id
       AND existing_shop.market <> (
         SELECT market FROM shop_connections
          WHERE organization_id = NEW.organization_id AND id = NEW.shop_id
       )
  ) THEN
    RAISE EXCEPTION 'credential binding market mismatch';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER shop_credential_bindings_integrity
BEFORE INSERT ON shop_credential_bindings
FOR EACH ROW EXECUTE FUNCTION validate_shop_credential_binding();

CREATE INDEX credential_subjects_status_idx
  ON credential_subjects (organization_id, status, updated_at);

COMMIT;
