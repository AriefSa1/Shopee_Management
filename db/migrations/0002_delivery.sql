CREATE TABLE delivery_commands (
  command_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  command_type text NOT NULL,
  schema_version integer NOT NULL CHECK (schema_version > 0),
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  dedupe_key text NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL,
  UNIQUE (organization_id, command_id),
  UNIQUE (organization_id, dedupe_key)
);

CREATE TABLE outbox_events (
  event_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  event_type text NOT NULL,
  schema_version integer NOT NULL CHECK (schema_version > 0),
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  command_id uuid NOT NULL,
  dedupe_key text NOT NULL,
  available_at timestamptz NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  created_at timestamptz NOT NULL,
  dispatched_at timestamptz,
  UNIQUE (organization_id, event_id),
  UNIQUE (organization_id, dedupe_key),
  FOREIGN KEY (organization_id, command_id)
    REFERENCES delivery_commands (organization_id, command_id)
);

CREATE TABLE queue_jobs (
  job_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  command_id uuid NOT NULL,
  outbox_event_id uuid UNIQUE,
  replay_of_dead_letter_id uuid UNIQUE,
  state text NOT NULL CHECK (
    state IN ('PENDING', 'LEASED', 'COMPLETED', 'ACKNOWLEDGED', 'RETRY_SCHEDULED', 'DEAD_LETTERED')
  ),
  available_at timestamptz NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  lease_owner text,
  lease_expires_at timestamptz,
  fencing_generation bigint NOT NULL DEFAULT 0 CHECK (fencing_generation >= 0),
  completed_at timestamptz,
  acknowledged_at timestamptz,
  created_at timestamptz NOT NULL,
  UNIQUE (organization_id, job_id),
  FOREIGN KEY (organization_id, command_id)
    REFERENCES delivery_commands (organization_id, command_id),
  FOREIGN KEY (organization_id, outbox_event_id)
    REFERENCES outbox_events (organization_id, event_id),
  CHECK (
    (state = 'LEASED' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (state <> 'LEASED')
  ),
  CHECK (acknowledged_at IS NULL OR completed_at IS NOT NULL)
);

CREATE TABLE scheduled_triggers (
  trigger_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  task_name text NOT NULL,
  target_key text NOT NULL,
  slot_at timestamptz NOT NULL,
  command_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (organization_id, trigger_id),
  UNIQUE (organization_id, task_name, target_key, slot_at),
  FOREIGN KEY (organization_id, command_id)
    REFERENCES delivery_commands (organization_id, command_id)
);

CREATE TABLE dead_letter_jobs (
  dead_letter_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  source_job_id uuid NOT NULL,
  command_id uuid NOT NULL,
  reason_code text NOT NULL,
  fencing_generation bigint NOT NULL CHECK (fencing_generation > 0),
  created_at timestamptz NOT NULL,
  UNIQUE (organization_id, dead_letter_id),
  UNIQUE (organization_id, source_job_id),
  FOREIGN KEY (organization_id, source_job_id)
    REFERENCES queue_jobs (organization_id, job_id),
  FOREIGN KEY (organization_id, command_id)
    REFERENCES delivery_commands (organization_id, command_id)
);

ALTER TABLE queue_jobs
  ADD CONSTRAINT queue_jobs_replay_dead_letter_scope_fk
  FOREIGN KEY (organization_id, replay_of_dead_letter_id)
  REFERENCES dead_letter_jobs (organization_id, dead_letter_id);

CREATE INDEX outbox_events_dispatch_ready_idx
  ON outbox_events (available_at, created_at)
  WHERE dispatched_at IS NULL;

CREATE INDEX queue_jobs_claim_ready_idx
  ON queue_jobs (available_at, created_at)
  WHERE state IN ('PENDING', 'RETRY_SCHEDULED');

CREATE INDEX queue_jobs_expired_lease_idx
  ON queue_jobs (lease_expires_at)
  WHERE state = 'LEASED';

CREATE INDEX queue_jobs_org_command_idx
  ON queue_jobs (organization_id, command_id);

CREATE INDEX dead_letter_jobs_org_created_idx
  ON dead_letter_jobs (organization_id, created_at);
