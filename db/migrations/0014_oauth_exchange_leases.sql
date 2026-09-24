BEGIN;

ALTER TABLE oauth_exchange_commands
  DROP CONSTRAINT oauth_exchange_commands_status_check;

ALTER TABLE oauth_exchange_commands
  ADD COLUMN lease_owner text,
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN failure_reason text,
  ADD CONSTRAINT oauth_exchange_commands_status_check
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  ADD CONSTRAINT oauth_exchange_commands_lease_check
    CHECK (
      (status = 'processing' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
      OR (status <> 'processing')
    ),
  ADD CONSTRAINT oauth_exchange_commands_failure_reason_check
    CHECK (failure_reason IS NULL OR failure_reason ~ '^[a-z_]{1,64}$');

CREATE INDEX oauth_exchange_commands_claim_idx
  ON oauth_exchange_commands (status, lease_expires_at, created_at)
  WHERE status IN ('pending', 'processing');

COMMIT;
