-- PRD v1: multi-option replies, thread summary on drafts, delegation audit trail

ALTER TABLE outbound_drafts
  ADD COLUMN IF NOT EXISTS reply_options jsonb,
  ADD COLUMN IF NOT EXISTS thread_summary text;

CREATE TABLE IF NOT EXISTS delegation_events (
  id bigserial PRIMARY KEY,
  event_type text NOT NULL,
  user_id text,
  channel text,
  account_id text,
  policy_action text,
  confidence double precision,
  policy_rule_id text,
  draft_id uuid,
  inbound_message_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS delegation_events_user_time
  ON delegation_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS delegation_events_draft
  ON delegation_events (draft_id)
  WHERE draft_id IS NOT NULL;
