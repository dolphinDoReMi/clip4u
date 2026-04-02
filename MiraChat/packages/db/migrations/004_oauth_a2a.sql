-- OAuth connectors (Gmail / Slack) + agent-to-agent protocol envelopes

CREATE TABLE IF NOT EXISTS oauth_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  provider text NOT NULL CHECK (provider IN ('google_gmail', 'slack')),
  access_token text NOT NULL,
  refresh_token text,
  expires_at timestamptz,
  scope text,
  external_subject text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);

CREATE INDEX IF NOT EXISTS oauth_accounts_user ON oauth_accounts (user_id);

CREATE TABLE IF NOT EXISTS a2a_envelopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol_version text NOT NULL DEFAULT 'mira-a2a/0.1',
  from_user_id text NOT NULL,
  to_user_id text NOT NULL,
  thread_ref text,
  intent text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  response_payload jsonb,
  status text NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'accepted', 'rejected', 'superseded')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS a2a_envelopes_to_status ON a2a_envelopes (to_user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS a2a_envelopes_thread ON a2a_envelopes (thread_ref)
  WHERE thread_ref IS NOT NULL;
