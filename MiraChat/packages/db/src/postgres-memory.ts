import type { MemoryService, MessageEvent, OutboundCommand, StoredMessage } from '@delegate-ai/adapter-types'
import type { Pool } from 'pg'

/** Max messages loaded per thread (full history cap). */
const DEFAULT_THREAD_LIMIT = 5000

/** Max rows returned from cross-thread message search. */
const DEFAULT_SEARCH_LIMIT = 80

const mapRow = (row: {
  id: string
  channel: string
  user_id: string
  sender_id: string
  thread_id: string
  direction: string
  content: string
  ts: Date
}): StoredMessage => ({
  id: row.id,
  channel: row.channel as StoredMessage['channel'],
  userId: row.user_id,
  senderId: row.sender_id,
  threadId: row.thread_id,
  direction: row.direction as StoredMessage['direction'],
  content: row.content,
  timestamp: row.ts.getTime(),
})

const searchTerms = (query: string): string[] =>
  query
    .toLowerCase()
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length >= 2)

export class PostgresMemoryService implements MemoryService {
  constructor(private readonly pool: Pool) {}

  async recordIncoming(_event: MessageEvent): Promise<void> {
    // In MiraChat, inbound persistence is handled by inbound_messages + API ingest.
  }

  async recordOutgoing(_command: OutboundCommand): Promise<void> {
    // Outbound history is represented by outbound_drafts once marked SENT.
  }

  async getRecentMessages(
    threadId: string,
    limit = DEFAULT_THREAD_LIMIT,
    userId?: string,
  ): Promise<StoredMessage[]> {
    const cap = Math.min(Math.max(1, limit), 20000)
    const uid = userId?.trim()
    const memoryUnion = uid
      ? `
        UNION ALL
        SELECT mc.id::text,
               'memory'::text AS channel,
               mc.user_id,
               mc.user_id AS sender_id,
               COALESCE(mc.thread_id, '') AS thread_id,
               'inbound'::text AS direction,
               mc.content,
               mc.created_at AS ts
        FROM memory_chunks mc
        WHERE mc.user_id = $3 AND mc.thread_id = $1
      `
      : ''
    const { rows } = await this.pool.query<{
      id: string
      channel: string
      user_id: string
      sender_id: string
      thread_id: string
      direction: string
      content: string
      ts: Date
    }>(
      `
      SELECT * FROM (
        SELECT * FROM (
          SELECT COALESCE(message_id, id::text) AS id, channel, user_id, sender_id, thread_id,
                 'inbound'::text AS direction, raw_text AS content, received_at AS ts
          FROM inbound_messages
          WHERE thread_id = $1
          UNION ALL
          SELECT id::text, channel, user_id, user_id AS sender_id, thread_id,
                 'outbound'::text AS direction,
                 COALESCE(NULLIF(trim(edited_text), ''), generated_text) AS content,
                 COALESCE(sent_at, updated_at) AS ts
          FROM outbound_drafts
          WHERE thread_id = $1 AND status = 'SENT'
          ${memoryUnion}
        ) t
        ORDER BY ts DESC
        LIMIT $2
      ) newest
      ORDER BY ts ASC
      `,
      uid ? [threadId, cap, uid] : [threadId, cap],
    )
    return rows.map(mapRow)
  }

  async searchMessages(userId: string, query: string, limit = DEFAULT_SEARCH_LIMIT): Promise<StoredMessage[]> {
    const terms = searchTerms(query)
    if (terms.length === 0) {
      return []
    }
    const cap = Math.min(Math.max(1, limit), 500)

    const { rows } = await this.pool.query<{
      id: string
      channel: string
      user_id: string
      sender_id: string
      thread_id: string
      direction: string
      content: string
      ts: Date
    }>(
      `
      SELECT id, channel, user_id, sender_id, thread_id, direction, content, ts
      FROM (
        SELECT COALESCE(message_id, id::text) AS id, channel, user_id, sender_id, thread_id,
               'inbound'::text AS direction, raw_text AS content, received_at AS ts,
               (
                 SELECT COUNT(*)::int FROM unnest($2::text[]) AS term
                 WHERE position(term in lower(raw_text)) > 0
               ) AS score
        FROM inbound_messages
        WHERE user_id = $1
        UNION ALL
        SELECT id::text, channel, user_id, user_id AS sender_id, thread_id,
               'outbound'::text AS direction,
               COALESCE(NULLIF(trim(edited_text), ''), generated_text) AS content,
               COALESCE(sent_at, updated_at) AS ts,
               (
                 SELECT COUNT(*)::int FROM unnest($2::text[]) AS term
                 WHERE position(term in lower(COALESCE(NULLIF(trim(edited_text), ''), generated_text))) > 0
               )
        FROM outbound_drafts
        WHERE user_id = $1 AND status = 'SENT'
        UNION ALL
        SELECT mc.id::text,
               'wechat'::text AS channel,
               mc.user_id,
               mc.user_id AS sender_id,
               COALESCE(mc.thread_id, '') AS thread_id,
               'inbound'::text AS direction,
               mc.content,
               mc.created_at AS ts,
               (
                 SELECT COUNT(*)::int FROM unnest($2::text[]) AS term
                 WHERE position(term in lower(mc.content)) > 0
               )
        FROM memory_chunks mc
        WHERE mc.user_id = $1
      ) ranked
      WHERE score > 0
      ORDER BY score DESC, ts DESC
      LIMIT $3
      `,
      [userId, terms, cap],
    )
    return rows.map(mapRow)
  }
}
