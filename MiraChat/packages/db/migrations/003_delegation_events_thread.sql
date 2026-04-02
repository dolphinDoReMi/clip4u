-- Measurement: thread-scoped queries + faster event_type scans for GQM rollups

ALTER TABLE delegation_events
  ADD COLUMN IF NOT EXISTS thread_id text;

CREATE INDEX IF NOT EXISTS delegation_events_thread_time
  ON delegation_events (thread_id, created_at DESC)
  WHERE thread_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS delegation_events_type_time
  ON delegation_events (event_type, created_at DESC);
