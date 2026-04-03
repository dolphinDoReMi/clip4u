-- Full-text search indexes for cross-thread / multimodal recall (inbound, sent outbound, memory_chunks).
-- Queries use to_tsvector('simple', ...) @@ plainto_tsquery('simple', ...) in application code.

CREATE INDEX IF NOT EXISTS inbound_messages_fts_gin
  ON inbound_messages USING gin (to_tsvector('simple', coalesce(raw_text, '')));

CREATE INDEX IF NOT EXISTS outbound_drafts_sent_fts_gin
  ON outbound_drafts USING gin (
    to_tsvector(
      'simple',
      coalesce(nullif(trim(edited_text), ''), generated_text, '')
    )
  )
  WHERE status = 'SENT';

CREATE INDEX IF NOT EXISTS memory_chunks_fts_gin
  ON memory_chunks USING gin (to_tsvector('simple', coalesce(content, '')));
