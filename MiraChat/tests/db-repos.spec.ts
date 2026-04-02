import type { Pool } from 'pg'
import { describe, expect, it, vi } from 'vitest'
import { upsertUserConnectionAuth } from '@delegate-ai/db'

describe('db repos', () => {
  it('clears stale qr payload when auth status is updated without a new qr code', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] })
    const pool = { query } as unknown as Pool

    await upsertUserConnectionAuth(pool, {
      channel: 'wechat',
      accountId: 'wechat-account',
      userId: 'demo-user',
      status: 'ONLINE',
    })

    const sql = query.mock.calls[0]?.[0] as string
    const params = query.mock.calls[0]?.[1] as unknown[]

    expect(sql).toContain('qr_payload = EXCLUDED.qr_payload')
    expect(sql).toContain('ELSE NULL END')
    expect(params[4]).toBeNull()
  })
})
