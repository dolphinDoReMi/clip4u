-- MiraChat: PostgreSQL as center of gravity (state, queue metadata, audit trail).
-- Requires PostgreSQL 14+. For pgvector, use an image such as pgvector/pgvector.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";

CREATE TABLE user_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL,
  account_id text NOT NULL,
  user_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('ONLINE', 'OFFLINE', 'AUTH_REQUIRED')),
  qr_payload text,
  qr_updated_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel, account_id)
);

CREATE TABLE inbound_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_connection_id uuid REFERENCES user_connections (id) ON DELETE SET NULL,
  contact_id text NOT NULL,
  room_id text,
  thread_id text NOT NULL,
  raw_text text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL CHECK (status IN ('PENDING', 'PROCESSING', 'DONE', 'FAILED')),
  channel text NOT NULL,
  account_id text NOT NULL,
  user_id text NOT NULL,
  sender_id text NOT NULL,
  message_id text,
  error text
);

CREATE INDEX inbound_messages_pending ON inbound_messages (status) WHERE status = 'PENDING';
CREATE INDEX inbound_messages_thread ON inbound_messages (thread_id, received_at DESC);

CREATE TABLE outbound_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inbound_message_id uuid REFERENCES inbound_messages (id) ON DELETE SET NULL,
  generated_text text NOT NULL,
  confidence_score double precision NOT NULL,
  status text NOT NULL CHECK (status IN ('DRAFTED', 'APPROVED', 'REJECTED', 'SENT', 'FAILED')),
  rule_triggered text,
  edited_text text,
  approved_at timestamptz,
  sent_at timestamptz,
  channel text NOT NULL,
  account_id text NOT NULL,
  user_id text NOT NULL,
  thread_id text NOT NULL,
  intent_summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX outbound_drafts_triage ON outbound_drafts (status, created_at DESC)
  WHERE status = 'DRAFTED';
CREATE INDEX outbound_drafts_pending_send ON outbound_drafts (status, channel, account_id)
  WHERE status = 'APPROVED' AND sent_at IS NULL;

CREATE TABLE relationship_graph (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  contact_id text NOT NULL,
  priority_tier int NOT NULL DEFAULT 2,
  relationship_type text NOT NULL DEFAULT 'unknown',
  auto_reply_enabled boolean NOT NULL DEFAULT false,
  tone_profile text NOT NULL DEFAULT 'warm',
  risk_level text NOT NULL DEFAULT 'medium',
  notes text[] NOT NULL DEFAULT '{}',
  UNIQUE (user_id, contact_id)
);

CREATE TABLE hard_constraints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  constraint_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX hard_constraints_user ON hard_constraints (user_id);

-- Chunked communication memory (pgvector). Embeddings optional until backfilled.
CREATE TABLE memory_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  thread_id text,
  content text NOT NULL,
  embedding vector(1536),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX memory_chunks_user ON memory_chunks (user_id, created_at DESC);

-- Transactional outbox for future fan-out (email/push). Not required for pg-boss MVP.
CREATE TABLE outbox_events (
  id bigserial PRIMARY KEY,
  topic text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);

CREATE INDEX outbox_events_unpublished ON outbox_events (published_at)
  WHERE published_at IS NULL;
