import type {
  MemorySearchOptions,
  MemoryService,
  MessageEvent,
  OutboundCommand,
  StoredMessage,
  StoredMessageSearchSource,
  StructuredMemoryRecall,
} from '@delegate-ai/adapter-types'
import { fetchStructuredMemoryRecall } from './repos.js'
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

/** Plain-text excerpt for UI (avoids ts_headline HTML in messages). */
export const buildSearchSnippet = (content: string, terms: string[], max = 240): string => {
  const text = content || ''
  if (!text) return ''
  const lower = text.toLowerCase()
  let bestIdx = -1
  let bestLen = 0
  for (const t of terms) {
    const i = lower.indexOf(t)
    if (i >= 0 && (bestIdx < 0 || i < bestIdx)) {
      bestIdx = i
      bestLen = t.length
    }
  }
  if (bestIdx < 0) {
    return text.length <= max ? text : `${text.slice(0, max - 1)}…`
  }
  const pad = 90
  const start = Math.max(0, bestIdx - pad)
  const end = Math.min(text.length, bestIdx + bestLen + pad)
  let s = text.slice(start, end)
  if (start > 0) s = `…${s}`
  if (end < text.length) s = `${s}…`
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

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
    const inboundUser = uid ? ' AND user_id = $3 ' : ''
    const outboundUser = uid ? ' AND user_id = $3 ' : ''
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
          WHERE thread_id = $1${inboundUser}
          UNION ALL
          SELECT id::text, channel, user_id, user_id AS sender_id, thread_id,
                 CASE WHEN status = 'SENT' THEN 'outbound' ELSE 'draft_reference' END AS direction,
                 COALESCE(NULLIF(trim(edited_text), ''), generated_text) AS content,
                 COALESCE(sent_at, updated_at) AS ts
          FROM outbound_drafts
          WHERE thread_id = $1 AND status IN ('SENT', 'REJECTED', 'DRAFTED')${outboundUser}
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

  async searchMessages(
    userId: string,
    query: string,
    limit = DEFAULT_SEARCH_LIMIT,
    options?: MemorySearchOptions,
  ): Promise<StoredMessage[]> {
    const terms = searchTerms(query)
    if (terms.length === 0) {
      return []
    }
    const cap = Math.min(Math.max(1, limit), 500)
    const threadId = options?.threadId?.trim() || null
    const ftsInput = query.trim()

    const threadInbound = threadId ? ' AND im.thread_id = $4 ' : ''
    const threadOutbound = threadId ? ' AND od.thread_id = $4 ' : ''
    const threadMemory = threadId ? ' AND COALESCE(mc.thread_id, \'\') = $4 ' : ''

    const baseParams: unknown[] = threadId ? [userId, ftsInput, cap, threadId] : [userId, ftsInput, cap]

    const ftsSql = `
      WITH q AS (SELECT plainto_tsquery('simple', $2) AS tsq)
      SELECT id, channel, user_id, sender_id, thread_id, direction, content, ts, rank, source_kind
      FROM (
        SELECT COALESCE(im.message_id, im.id::text) AS id,
               im.channel,
               im.user_id,
               im.sender_id,
               im.thread_id,
               'inbound'::text AS direction,
               im.raw_text AS content,
               im.received_at AS ts,
               ts_rank_cd(to_tsvector('simple', coalesce(im.raw_text, '')), q.tsq) AS rank,
               'inbound'::text AS source_kind
        FROM inbound_messages im
        CROSS JOIN q
        WHERE im.user_id = $1
          ${threadInbound}
          AND to_tsvector('simple', coalesce(im.raw_text, '')) @@ q.tsq
        UNION ALL
        SELECT od.id::text,
               od.channel,
               od.user_id,
               od.user_id AS sender_id,
               od.thread_id,
               'outbound'::text AS direction,
               COALESCE(NULLIF(trim(od.edited_text), ''), od.generated_text) AS content,
               COALESCE(od.sent_at, od.updated_at) AS ts,
               ts_rank_cd(
                 to_tsvector(
                   'simple',
                   coalesce(nullif(trim(od.edited_text), ''), od.generated_text, '')
                 ),
                 q.tsq
               ) AS rank,
               'outbound'::text AS source_kind
        FROM outbound_drafts od
        CROSS JOIN q
        WHERE od.user_id = $1
          AND od.status = 'SENT'
          ${threadOutbound}
          AND to_tsvector(
                'simple',
                coalesce(nullif(trim(od.edited_text), ''), od.generated_text, '')
              ) @@ q.tsq
        UNION ALL
        SELECT mc.id::text,
               'memory'::text AS channel,
               mc.user_id,
               mc.user_id AS sender_id,
               COALESCE(mc.thread_id, '') AS thread_id,
               'inbound'::text AS direction,
               mc.content,
               mc.created_at AS ts,
               ts_rank_cd(to_tsvector('simple', coalesce(mc.content, '')), q.tsq) AS rank,
               'memory'::text AS source_kind
        FROM memory_chunks mc
        CROSS JOIN q
        WHERE mc.user_id = $1
          ${threadMemory}
          AND to_tsvector('simple', coalesce(mc.content, '')) @@ q.tsq
      ) hits
      ORDER BY rank DESC, ts DESC
      LIMIT $3
    `

    type SearchRow = {
      id: string
      channel: string
      user_id: string
      sender_id: string
      thread_id: string
      direction: string
      content: string
      ts: Date
      rank: number
      source_kind: string
    }

    let { rows } = await this.pool.query<SearchRow>(ftsSql, baseParams)

    if (rows.length === 0) {
      const legacySql = `
        SELECT id, channel, user_id, sender_id, thread_id, direction, content, ts, score::float8 AS rank, source_kind
        FROM (
          SELECT COALESCE(im.message_id, im.id::text) AS id, im.channel, im.user_id, im.sender_id, im.thread_id,
                 'inbound'::text AS direction, im.raw_text AS content, im.received_at AS ts,
                 (
                   SELECT COUNT(*)::int FROM unnest($2::text[]) AS term
                   WHERE position(term in lower(im.raw_text)) > 0
                 ) AS score,
                 'inbound'::text AS source_kind
          FROM inbound_messages im
          WHERE im.user_id = $1
            ${threadInbound}
          UNION ALL
          SELECT od.id::text, od.channel, od.user_id, od.user_id AS sender_id, od.thread_id,
                 'outbound'::text AS direction,
                 COALESCE(NULLIF(trim(od.edited_text), ''), od.generated_text) AS content,
                 COALESCE(od.sent_at, od.updated_at) AS ts,
                 (
                   SELECT COUNT(*)::int FROM unnest($2::text[]) AS term
                   WHERE position(term in lower(COALESCE(NULLIF(trim(od.edited_text), ''), od.generated_text))) > 0
                 ) AS score,
                 'outbound'::text AS source_kind
          FROM outbound_drafts od
          WHERE od.user_id = $1 AND od.status = 'SENT'
            ${threadOutbound}
          UNION ALL
          SELECT mc.id::text,
                 'memory'::text AS channel,
                 mc.user_id,
                 mc.user_id AS sender_id,
                 COALESCE(mc.thread_id, '') AS thread_id,
                 'inbound'::text AS direction,
                 mc.content,
                 mc.created_at AS ts,
                 (
                   SELECT COUNT(*)::int FROM unnest($2::text[]) AS term
                   WHERE position(term in lower(mc.content)) > 0
                 ) AS score,
                 'memory'::text AS source_kind
          FROM memory_chunks mc
          WHERE mc.user_id = $1
            ${threadMemory}
        ) ranked
        WHERE score > 0
        ORDER BY score DESC, ts DESC
        LIMIT $3
      `
      const legacyParams: unknown[] = threadId ? [userId, terms, cap, threadId] : [userId, terms, cap]
      const legacy = await this.pool.query<SearchRow>(legacySql, legacyParams)
      rows = legacy.rows
    }

    const mapSearch = (row: SearchRow): StoredMessage => {
      const base = mapRow({
        id: row.id,
        channel: row.channel,
        user_id: row.user_id,
        sender_id: row.sender_id,
        thread_id: row.thread_id,
        direction: row.direction,
        content: row.content,
        ts: row.ts,
      })
      const sk = row.source_kind as StoredMessageSearchSource
      return {
        ...base,
        searchSnippet: buildSearchSnippet(row.content, terms),
        searchSource: sk,
        searchRank: Number(row.rank) || 0,
      }
    }

    return rows.map(mapSearch)
  }

  async getStructuredRecall(userId: string, threadId: string): Promise<StructuredMemoryRecall | null> {
    const row = await fetchStructuredMemoryRecall(this.pool, userId, threadId)
    if (!row.internalSummary.trim() && !row.entityBullets.trim() && !row.eventBullets.trim()) {
      return null
    }
    return {
      internalSummary: row.internalSummary,
      entityBullets: row.entityBullets,
      eventBullets: row.eventBullets,
    }
  }
}
