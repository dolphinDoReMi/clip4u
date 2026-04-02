/**
 * Full inbound → worker → outbound row (requires Postgres + migrations).
 * Run with a real PostgreSQL + pgvector connection:
 * `E2E_DATABASE_URL=postgresql://... npm run test:prd:db`
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pg from 'pg'
import {
  runMigrations,
  insertInboundMessage,
  upsertUserConnection,
  getUserConnection,
  PostgresIdentityService,
  PostgresMemoryService,
} from '@delegate-ai/db'
import { processInboundJob } from '../../services/api/src/mirachat-worker.ts'

/** Set `E2E_DATABASE_URL` or `DATABASE_URL` to run (same DB as Playwright UI tests). */
const conn = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL

describe.skipIf(!conn)('E2E: MiraChat worker pipeline (real Postgres)', () => {
  let pool: pg.Pool

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: conn! })
    await runMigrations(pool)
  })

  afterAll(async () => {
    await pool.end()
  })

  it('processes inbound into an outbound_drafts row', async () => {
    const suffix = `${Date.now()}`
    const userId = `e2e-${suffix}`
    const accountId = `ACe2e${suffix.slice(-8)}`
    const channel = 'twilio_sms'
    const threadId = `+1555${suffix.slice(-7)}`

    await upsertUserConnection(pool, { channel, accountId, userId, status: 'ONLINE' })
    const connRow = await getUserConnection(pool, channel, accountId)

    const inboundId = await insertInboundMessage(pool, {
      userConnectionId: connRow?.id ?? null,
      contactId: threadId,
      roomId: null,
      threadId,
      rawText: 'E2E ping — please acknowledge.',
      channel,
      accountId,
      userId,
      senderId: threadId,
      messageId: `SMe2e${suffix}`,
    })

    const identity = new PostgresIdentityService(pool)
    const memory = new PostgresMemoryService(pool)
    await processInboundJob(pool, identity, memory, inboundId)

    const { rows } = await pool.query<{ status: string; inbound_message_id: string }>(
      `SELECT status, inbound_message_id::text FROM outbound_drafts WHERE inbound_message_id = $1`,
      [inboundId],
    )
    expect(rows.length).toBe(1)
    expect(['DRAFTED', 'APPROVED', 'REJECTED']).toContain(rows[0]!.status)
  })
})
