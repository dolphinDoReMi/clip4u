CREATE TABLE IF NOT EXISTS identity_profiles (
  user_id text PRIMARY KEY,
  display_name text NOT NULL DEFAULT 'Mira User',
  tone text NOT NULL DEFAULT 'warm, direct, concise',
  style_guide text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

