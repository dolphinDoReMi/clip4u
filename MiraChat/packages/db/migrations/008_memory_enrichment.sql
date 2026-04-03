-- Structured memory: entities, timeline events, narrative snapshot (PRD §5.B.1 / system-design §14).

CREATE TABLE memory_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  thread_id text,
  source_inbound_id uuid REFERENCES inbound_messages (id) ON DELETE SET NULL,
  surface_form text NOT NULL,
  entity_type text NOT NULL,
  canonical_label text NOT NULL,
  normalized_key text NOT NULL,
  confidence double precision,
  contact_id text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT memory_entities_user_norm_unique UNIQUE (user_id, normalized_key)
);

CREATE INDEX memory_entities_user_updated ON memory_entities (user_id, updated_at DESC);

CREATE TABLE memory_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  thread_id text,
  source_inbound_id uuid REFERENCES inbound_messages (id) ON DELETE SET NULL,
  kind text NOT NULL,
  summary text NOT NULL,
  entities_touched text[] NOT NULL DEFAULT '{}',
  ordering_hint text,
  recurrence text,
  due_hint timestamptz,
  confidence double precision,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX memory_events_user_thread ON memory_events (user_id, thread_id, created_at DESC);
CREATE INDEX memory_events_user_created ON memory_events (user_id, created_at DESC);

CREATE TABLE memory_narrative_snapshots (
  user_id text PRIMARY KEY,
  narrative_markdown text NOT NULL DEFAULT '',
  internal_summary text NOT NULL DEFAULT '',
  pending_conflicts jsonb,
  version int NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memory_enrichment_runs (
  user_id text NOT NULL,
  source_inbound_id uuid NOT NULL REFERENCES inbound_messages (id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('success', 'skipped', 'failed')),
  detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, source_inbound_id)
);
