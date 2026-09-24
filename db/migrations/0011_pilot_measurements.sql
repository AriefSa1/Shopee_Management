BEGIN;

CREATE TABLE pilot_workflow_measurements (
  measurement_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  captured_at timestamptz NOT NULL,
  workflow text NOT NULL CHECK (workflow = 'multi_store_product_management'),
  baseline_minutes numeric NOT NULL CHECK (baseline_minutes > 0),
  observed_minutes numeric NOT NULL CHECK (observed_minutes >= 0),
  sample_count integer NOT NULL CHECK (sample_count > 0),
  target_reduction_percent numeric NOT NULL CHECK (target_reduction_percent > 0 AND target_reduction_percent <= 100),
  reduction_percent numeric NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('target_met', 'target_missed')),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (organization_id, measurement_id),
  CHECK (
    (outcome = 'target_met' AND reduction_percent >= target_reduction_percent)
    OR (outcome = 'target_missed' AND reduction_percent < target_reduction_percent)
  )
);

CREATE INDEX pilot_workflow_measurements_recent_idx
  ON pilot_workflow_measurements (organization_id, captured_at DESC);

CREATE OR REPLACE FUNCTION reject_pilot_measurement_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'pilot workflow measurements are immutable';
END;
$$;

CREATE TRIGGER pilot_workflow_measurements_immutable
BEFORE UPDATE OR DELETE ON pilot_workflow_measurements
FOR EACH ROW EXECUTE FUNCTION reject_pilot_measurement_mutation();

COMMIT;
