ALTER TABLE outbound_drafts
  ADD COLUMN IF NOT EXISTS send_attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_send_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_send_error text,
  ADD COLUMN IF NOT EXISTS next_send_after timestamptz,
  ADD COLUMN IF NOT EXISTS dead_lettered_at timestamptz;

CREATE INDEX IF NOT EXISTS outbound_drafts_retry_queue
  ON outbound_drafts (status, channel, account_id, next_send_after, approved_at)
  WHERE status = 'APPROVED' AND sent_at IS NULL;

CREATE INDEX IF NOT EXISTS outbound_drafts_dead_letter
  ON outbound_drafts (status, updated_at DESC)
  WHERE status = 'FAILED';
