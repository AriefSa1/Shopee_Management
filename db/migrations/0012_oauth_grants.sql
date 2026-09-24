BEGIN;

CREATE TABLE oauth_grants (
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  grant_id uuid NOT NULL,
  partner_application_id text NOT NULL CHECK (length(btrim(partner_application_id)) > 0),
  grant_kind text NOT NULL CHECK (grant_kind IN ('shop_account', 'main_account')),
  granted_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (organization_id, grant_id)
);

CREATE TABLE oauth_grant_subjects (
  organization_id uuid NOT NULL,
  grant_id uuid NOT NULL,
  credential_subject_id uuid NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  key_version integer NOT NULL CHECK (key_version > 0),
  PRIMARY KEY (organization_id, grant_id, credential_subject_id),
  FOREIGN KEY (organization_id, grant_id)
    REFERENCES oauth_grants (organization_id, grant_id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, credential_subject_id)
    REFERENCES credential_subjects (organization_id, credential_subject_id) ON DELETE RESTRICT
);

CREATE TABLE oauth_grant_subject_shops (
  organization_id uuid NOT NULL,
  grant_id uuid NOT NULL,
  credential_subject_id uuid NOT NULL,
  shop_id uuid NOT NULL,
  PRIMARY KEY (organization_id, grant_id, credential_subject_id, shop_id),
  FOREIGN KEY (organization_id, grant_id, credential_subject_id)
    REFERENCES oauth_grant_subjects (organization_id, grant_id, credential_subject_id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, shop_id)
    REFERENCES shop_connections (organization_id, id) ON DELETE RESTRICT
);

CREATE FUNCTION validate_oauth_grant_shop_binding()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  grant_partner_application text;
  subject_partner_application text;
  shop_partner_application text;
  shop_status text;
BEGIN
  SELECT partner_application_id INTO grant_partner_application
    FROM oauth_grants
   WHERE organization_id = NEW.organization_id AND grant_id = NEW.grant_id;
  SELECT cs.partner_application_id INTO subject_partner_application
    FROM oauth_grant_subjects AS gs
    JOIN credential_subjects AS cs
      ON cs.organization_id = gs.organization_id
     AND cs.credential_subject_id = gs.credential_subject_id
   WHERE gs.organization_id = NEW.organization_id
     AND gs.grant_id = NEW.grant_id
     AND gs.credential_subject_id = NEW.credential_subject_id;
  SELECT partner_application_id::text, status INTO shop_partner_application, shop_status
    FROM shop_connections
   WHERE organization_id = NEW.organization_id AND id = NEW.shop_id;
  IF shop_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'grant binding requires an active shop connection';
  END IF;
  IF grant_partner_application IS DISTINCT FROM subject_partner_application
     OR shop_partner_application IS DISTINCT FROM grant_partner_application THEN
    RAISE EXCEPTION 'grant binding partner application mismatch';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM oauth_grant_subject_shops AS existing_binding
      JOIN shop_connections AS existing_shop
        ON existing_shop.organization_id = existing_binding.organization_id
       AND existing_shop.id = existing_binding.shop_id
     WHERE existing_binding.organization_id = NEW.organization_id
       AND existing_binding.grant_id = NEW.grant_id
       AND existing_binding.credential_subject_id = NEW.credential_subject_id
       AND existing_shop.market <> (
         SELECT market FROM shop_connections
          WHERE organization_id = NEW.organization_id AND id = NEW.shop_id
       )
  ) THEN
    RAISE EXCEPTION 'grant binding market mismatch';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER oauth_grant_subject_shops_integrity
BEFORE INSERT ON oauth_grant_subject_shops
FOR EACH ROW EXECUTE FUNCTION validate_oauth_grant_shop_binding();

CREATE INDEX oauth_grants_recent_idx
  ON oauth_grants (organization_id, granted_at DESC);

COMMIT;
