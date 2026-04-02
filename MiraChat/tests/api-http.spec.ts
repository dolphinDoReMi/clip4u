/**
 * HTTP-level checks for delegate-ai API with mocked PostgreSQL + pg-boss.
 */
import { createServer, request as httpRequest } from 'node:http'
import type { IncomingMessage } from 'node:http'
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import type { Pool } from 'pg'
import { createInMemoryRuntime } from '@delegate-ai/agent-core'
import { MIRACHAT_INBOUND_QUEUE } from '@delegate-ai/db'
import { createMiniProgramSessionToken } from '../services/api/src/mini-program.ts'
import {
  createDelegateApiListener,
  type MirachatSqlContext,
} from '../services/api/src/api-listener.ts'

const createInboundRouteMockMirachat = (): MirachatSqlContext => {
  let inboundIdSeq = 0
  const bossSend = vi.fn().mockResolvedValue(undefined)
  const pool = {
    query: vi.fn(async (text: string) => {
      if (/INSERT INTO user_connections/.test(text) && /ON CONFLICT/.test(text)) {
        return { rows: [{ id: 'uc-mock-1' }] }
      }
      if (/FROM user_connections WHERE channel = \$1/.test(text)) {
        return {
          rows: [
            {
              id: 'uc-mock-1',
              channel: 'twilio_sms',
              account_id: 'AC_test',
              user_id: 'demo-user',
              status: 'ONLINE',
              qr_payload: null,
              qr_updated_at: null,
              updated_at: new Date(),
            },
          ],
        }
      }
      if (/INSERT INTO inbound_messages/.test(text)) {
        inboundIdSeq += 1
        return { rows: [{ id: `inbound-mock-${inboundIdSeq}` }] }
      }
      if (/INSERT INTO delegation_events/.test(text)) {
        return { rows: [] }
      }
      throw new Error(`api-http mock: unhandled SQL: ${text.slice(0, 100).replace(/\s+/g, ' ')}`)
    }),
  } as unknown as Pool

  const boss = { send: bossSend } as MirachatSqlContext['boss']

  return {
    pool,
    boss,
    mirachatIdentity: {} as MirachatSqlContext['mirachatIdentity'],
    mirachatMemory: {} as MirachatSqlContext['mirachatMemory'],
  }
}

const request = (
  port: number,
  opts: { method: string; path: string; body?: string; headers?: Record<string, string> },
): Promise<{ status: number; body: string; headers: IncomingMessage['headers'] }> =>
  new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        method: opts.method,
        path: opts.path,
        headers: {
          ...(opts.body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(opts.body) } : {}),
          ...opts.headers,
        },
      },
      (res: IncomingMessage) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
            headers: res.headers,
          })
        })
        res.on('error', reject)
      },
    )
    req.on('error', reject)
    if (opts.body) {
      req.write(opts.body)
    }
    req.end()
  })

describe('Delegate API HTTP (mocked SQL)', () => {
  describe('OAuth start without DB', () => {
    beforeAll(() => {
      process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-client'
      process.env.GOOGLE_OAUTH_REDIRECT_URI = 'http://localhost/cb'
    })
    afterAll(() => {
      delete process.env.GOOGLE_OAUTH_CLIENT_ID
      delete process.env.GOOGLE_OAUTH_REDIRECT_URI
    })

    it('GET /oauth/google/start redirects when client id is set (no MiraChat SQL)', async () => {
      const listener = createDelegateApiListener({
        memoryRuntime: createInMemoryRuntime(),
        mirachat: null,
      })
      const server = createServer(listener)
      await new Promise<void>(r => server.listen(0, r))
      const port = (server.address() as import('node:net').AddressInfo).port
      const res = await request(port, { method: 'GET', path: '/oauth/google/start?userId=u1' })
      expect(res.status).toBe(302)
      const loc = res.headers.location
      expect(typeof loc === 'string' && loc.includes('accounts.google.com')).toBe(true)
      expect(loc).toContain('test-client')
      await new Promise<void>((r, j) => server.close(e => (e ? j(e) : r())))
    })
  })

  it('GET /mirachat/drafts 404 when MiraChat SQL is disabled', async () => {
    const listener = createDelegateApiListener({
      memoryRuntime: createInMemoryRuntime(),
      mirachat: null,
    })
    const server = createServer(listener)
    await new Promise<void>(r => server.listen(0, r))
    const port = (server.address() as import('node:net').AddressInfo).port
    const res = await request(port, { method: 'GET', path: '/mirachat/drafts' })
    expect(res.status).toBe(404)
    await new Promise<void>((r, j) => server.close(e => (e ? j(e) : r())))
  })

  it('GET /health reports mirachat off when context has no DB', async () => {
    const listener = createDelegateApiListener({
      memoryRuntime: createInMemoryRuntime(),
      mirachat: null,
    })
    const server = createServer(listener)
    await new Promise<void>(r => server.listen(0, r))
    const addr = server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    const res = await request(port, { method: 'GET', path: '/health' })
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body).mirachat).toBe(false)
    await new Promise<void>((r, j) => server.close(e => (e ? j(e) : r())))
  })

  it('GET /health/mirachat-worker reports mirachat off when context has no DB', async () => {
    const listener = createDelegateApiListener({
      memoryRuntime: createInMemoryRuntime(),
      mirachat: null,
    })
    const server = createServer(listener)
    await new Promise<void>(r => server.listen(0, r))
    const addr = server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    const res = await request(port, { method: 'GET', path: '/health/mirachat-worker' })
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ ok: true, mirachat: false })
    await new Promise<void>((r, j) => server.close(e => (e ? j(e) : r())))
  })

  it('GET /health/mirachat-worker 503 when mirachatWorkerReady is false', async () => {
    const mirachat = createInboundRouteMockMirachat()
    const listener = createDelegateApiListener({
      memoryRuntime: createInMemoryRuntime(),
      mirachat,
      mirachatWorkerReady: false,
    })
    const server = createServer(listener)
    await new Promise<void>(r => server.listen(0, r))
    const addr = server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    const res = await request(port, { method: 'GET', path: '/health/mirachat-worker' })
    expect(res.status).toBe(503)
    const j = JSON.parse(res.body) as { ok: boolean; workerReady: boolean }
    expect(j.ok).toBe(false)
    expect(j.workerReady).toBe(false)
    await new Promise<void>((r, j) => server.close(e => (e ? j(e) : r())))
  })

  it('GET /health/mirachat-worker 200 when mirachat is mocked and worker flag omitted', async () => {
    const mirachat = createInboundRouteMockMirachat()
    const listener = createDelegateApiListener({
      memoryRuntime: createInMemoryRuntime(),
      mirachat,
    })
    const server = createServer(listener)
    await new Promise<void>(r => server.listen(0, r))
    const addr = server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0
    const res = await request(port, { method: 'GET', path: '/health/mirachat-worker' })
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ ok: true, mirachat: true, workerReady: true })
    await new Promise<void>((r, j) => server.close(e => (e ? j(e) : r())))
  })

  it('POST /mirachat/inbound returns 202 and enqueues pg-boss job (mocked pool)', async () => {
    const mirachat = createInboundRouteMockMirachat()
    const listener = createDelegateApiListener({
      memoryRuntime: createInMemoryRuntime(),
      mirachat,
    })
    const server = createServer(listener)
    await new Promise<void>(r => server.listen(0, r))
    const addr = server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0

    const payload = JSON.stringify({
      channel: 'twilio_sms',
      accountId: 'AC_test',
      userId: 'demo-user',
      contactId: '+15550001',
      threadId: '+15550001',
      text: 'Hello from SMS',
      senderId: '+15550001',
      messageId: 'SM_mock',
    })
    const res = await request(port, { method: 'POST', path: '/mirachat/inbound', body: payload })
    expect(res.status).toBe(202)
    const json = JSON.parse(res.body) as { ok: boolean; inboundMessageId: string }
    expect(json.ok).toBe(true)
    expect(json.inboundMessageId).toMatch(/^inbound-mock-/)

    const bossSend = (mirachat.boss as unknown as { send: ReturnType<typeof vi.fn> }).send
    expect(bossSend).toHaveBeenCalledWith(MIRACHAT_INBOUND_QUEUE, {
      inboundMessageId: json.inboundMessageId,
    })

    await new Promise<void>((r, j) => server.close(e => (e ? j(e) : r())))
  })

  it('POST /mirachat/instrumentation/twilio-status records delegation event (mocked pool)', async () => {
    const delegationInserts: string[] = []
    const pool = {
      query: vi.fn(async (text: string) => {
        if (/INSERT INTO delegation_events/.test(text)) {
          delegationInserts.push(text)
          return { rows: [] }
        }
        throw new Error(`unexpected: ${text.slice(0, 80)}`)
      }),
    } as unknown as Pool
    const mirachat: MirachatSqlContext = {
      pool,
      boss: { send: vi.fn() } as MirachatSqlContext['boss'],
      mirachatIdentity: {} as MirachatSqlContext['mirachatIdentity'],
      mirachatMemory: {} as MirachatSqlContext['mirachatMemory'],
    }
    const listener = createDelegateApiListener({
      memoryRuntime: createInMemoryRuntime(),
      mirachat,
    })
    const server = createServer(listener)
    await new Promise<void>(r => server.listen(0, r))
    const addr = server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0

    const res = await request(port, {
      method: 'POST',
      path: '/mirachat/instrumentation/twilio-status',
      body: JSON.stringify({ MessageSid: 'SMx', MessageStatus: 'delivered' }),
    })
    expect(res.status).toBe(200)
    expect(delegationInserts.length).toBe(1)

    await new Promise<void>((r, j) => server.close(e => (e ? j(e) : r())))
  })

  it('GET /mirachat/threads returns camelCase thread summaries for the UI', async () => {
    const pool = {
      query: vi.fn(async (text: string) => {
        if (/FROM \(/.test(text) && /GROUP BY activity\.thread_id/.test(text)) {
          return {
            rows: [
              {
                thread_id: 'qa-contact',
                last_at: new Date('2026-04-02T03:13:28.206Z'),
                preview: 'Can you follow up tomorrow morning and keep the tone warm?',
                message_count: '2',
              },
            ],
          }
        }
        throw new Error(`unexpected: ${text.slice(0, 120)}`)
      }),
    } as unknown as Pool

    const mirachat: MirachatSqlContext = {
      pool,
      boss: { send: vi.fn() } as MirachatSqlContext['boss'],
      mirachatIdentity: {} as MirachatSqlContext['mirachatIdentity'],
      mirachatMemory: {
        getRecentMessages: vi.fn(),
      } as unknown as MirachatSqlContext['mirachatMemory'],
    }

    const listener = createDelegateApiListener({
      memoryRuntime: createInMemoryRuntime(),
      mirachat,
    })
    const server = createServer(listener)
    await new Promise<void>(r => server.listen(0, r))
    const addr = server.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0

    const res = await request(port, {
      method: 'GET',
      path: '/mirachat/threads?userId=demo-user',
    })
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual([
      {
        threadId: 'qa-contact',
        lastAt: '2026-04-02T03:13:28.206Z',
        preview: 'Can you follow up tomorrow morning and keep the tone warm?',
        messageCount: 2,
      },
    ])

    await new Promise<void>((r, j) => server.close(e => (e ? j(e) : r())))
  })

  it('POST /assist returns suggestions without PostgreSQL (PRD assist / G2)', async () => {
    const listener = createDelegateApiListener({
      memoryRuntime: createInMemoryRuntime(),
      mirachat: null,
    })
    const server = createServer(listener)
    await new Promise<void>(r => server.listen(0, r))
    const port = (server.address() as import('node:net').AddressInfo).port
    const res = await request(port, {
      method: 'POST',
      path: '/assist',
      body: JSON.stringify({ userId: 'u1', prompt: 'Short RSVP decline.' }),
    })
    expect(res.status).toBe(200)
    const body = JSON.parse(res.body) as unknown[]
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBeGreaterThanOrEqual(3)
    await new Promise<void>((r, j) => server.close(e => (e ? j(e) : r())))
  })

  it('POST /simulate-message returns decision + draft without PostgreSQL', async () => {
    const listener = createDelegateApiListener({
      memoryRuntime: createInMemoryRuntime(),
      mirachat: null,
    })
    const server = createServer(listener)
    await new Promise<void>(r => server.listen(0, r))
    const port = (server.address() as import('node:net').AddressInfo).port
    const res = await request(port, {
      method: 'POST',
      path: '/simulate-message',
      body: JSON.stringify({ userId: 'u1', text: 'Ping' }),
    })
    expect(res.status).toBe(200)
    const json = JSON.parse(res.body) as { decision: { action: string }; draft: { response: string } }
    expect(json.decision.action).toBeDefined()
    expect(json.draft.response.length).toBeGreaterThan(0)
    await new Promise<void>((r, j) => server.close(e => (e ? j(e) : r())))
  })

  it('GET /mirachat/delegation-events lists rows from SQL (GQM audit API)', async () => {
    const sampleRow = {
      id: 'ev-1',
      event_type: 'inbound.enqueued',
      user_id: 'u1',
      channel: 'wechat',
      account_id: 'a1',
      thread_id: null,
      policy_action: null,
      confidence: null,
      policy_rule_id: null,
      draft_id: null,
      inbound_message_id: 'in-1',
      metadata: {},
      created_at: new Date(),
    }
    const pool = {
      query: vi.fn(async (text: string) => {
        if (/FROM delegation_events/.test(text) && /ORDER BY created_at/.test(text)) {
          return { rows: [sampleRow] }
        }
        throw new Error(`delegation-events mock: ${text.slice(0, 70)}`)
      }),
    } as unknown as Pool
    const mirachat: MirachatSqlContext = {
      pool,
      boss: { send: vi.fn() } as MirachatSqlContext['boss'],
      mirachatIdentity: {} as MirachatSqlContext['mirachatIdentity'],
      mirachatMemory: {} as MirachatSqlContext['mirachatMemory'],
    }
    const server = createServer(
      createDelegateApiListener({ memoryRuntime: createInMemoryRuntime(), mirachat }),
    )
    await new Promise<void>(r => server.listen(0, r))
    const port = (server.address() as import('node:net').AddressInfo).port
    const res = await request(port, { method: 'GET', path: '/mirachat/delegation-events?limit=10' })
    expect(res.status).toBe(200)
    const json = JSON.parse(res.body) as typeof sampleRow[]
    expect(json[0]!.event_type).toBe('inbound.enqueued')
    await new Promise<void>((r, j) => server.close(e => (e ? j(e) : r())))
  })

  it('GET /mirachat/metrics returns GQM rollup shape (mocked SQL)', async () => {
    const pool = {
      query: vi.fn(async (text: string) => {
        if (/SELECT event_type, COUNT\(\*\)/.test(text)) {
          return { rows: [{ event_type: 'draft.approved_as_is', c: '10' }] }
        }
        if (/SELECT policy_action, COUNT\(\*\)/.test(text)) {
          return { rows: [{ policy_action: 'REVIEW', c: '3' }] }
        }
        if (/COUNT\(DISTINCT user_id\)::text AS active_users/.test(text)) {
          return { rows: [{ active_users: '1', active_threads: '1' }] }
        }
        if (/AVG\(EXTRACT\(EPOCH FROM \(d\.created_at - i\.received_at\)\)\)/.test(text)) {
          return {
            rows: [
              {
                avg_draft_latency_seconds: 10,
                avg_approval_latency_seconds: 20,
                avg_send_latency_seconds: 5,
                avg_resolution_seconds: 35,
              },
            ],
          }
        }
        if (/FROM relationship_graph rg/.test(text) && /memory_chunks mc/.test(text)) {
          return {
            rows: [
              {
                relationship_count: '2',
                high_risk_relationship_count: '0',
                auto_reply_enabled_count: '0',
                hard_constraint_count: '1',
                memory_chunk_count: '4',
              },
            ],
          }
        }
        if (/feedback\.sounds_like_me/.test(text) && /feedback\.regret/.test(text)) {
          return {
            rows: [
              {
                avg_sounds_like_me_score: null,
                sounds_like_me_count: '0',
                regret_count: '0',
                boundary_violation_count: '0',
              },
            ],
          }
        }
        if (/to_char\(created_at::date, 'YYYY-MM-DD'\) AS day/.test(text)) {
          return { rows: [] }
        }
        throw new Error(`metrics mock: ${text.slice(0, 70)}`)
      }),
    } as unknown as Pool
    const mirachat: MirachatSqlContext = {
      pool,
      boss: { send: vi.fn() } as MirachatSqlContext['boss'],
      mirachatIdentity: {} as MirachatSqlContext['mirachatIdentity'],
      mirachatMemory: {} as MirachatSqlContext['mirachatMemory'],
    }
    const server = createServer(
      createDelegateApiListener({ memoryRuntime: createInMemoryRuntime(), mirachat }),
    )
    await new Promise<void>(r => server.listen(0, r))
    const port = (server.address() as import('node:net').AddressInfo).port
    const res = await request(port, { method: 'GET', path: '/mirachat/metrics?days=7' })
    expect(res.status).toBe(200)
    const json = JSON.parse(res.body) as { eventCounts: Record<string, number>; policyActionCounts: Record<string, number> }
    expect(json.eventCounts['draft.approved_as_is']).toBe(10)
    expect(json.policyActionCounts.REVIEW).toBe(3)
    await new Promise<void>((r, j) => server.close(e => (e ? j(e) : r())))
  })

  it('GET /mirachat/connection returns user_connections row', async () => {
    const pool = {
      query: vi.fn(async (text: string) => {
        if (/FROM user_connections WHERE channel/.test(text)) {
          return {
            rows: [
              {
                id: 'uc-1',
                channel: 'wechat',
                account_id: 'default-account',
                user_id: 'demo-user',
                status: 'ONLINE',
                qr_payload: null,
                qr_updated_at: null,
                updated_at: new Date(),
              },
            ],
          }
        }
        throw new Error(`connection mock: ${text.slice(0, 70)}`)
      }),
    } as unknown as Pool
    const mirachat: MirachatSqlContext = {
      pool,
      boss: { send: vi.fn() } as MirachatSqlContext['boss'],
      mirachatIdentity: {} as MirachatSqlContext['mirachatIdentity'],
      mirachatMemory: {} as MirachatSqlContext['mirachatMemory'],
    }
    const server = createServer(
      createDelegateApiListener({ memoryRuntime: createInMemoryRuntime(), mirachat }),
    )
    await new Promise<void>(r => server.listen(0, r))
    const port = (server.address() as import('node:net').AddressInfo).port
    const res = await request(port, {
      method: 'GET',
      path: '/mirachat/connection?channel=wechat&accountId=default-account',
    })
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body).status).toBe('ONLINE')
    await new Promise<void>((r, j) => server.close(e => (e ? j(e) : r())))
  })

  it('POST /mirachat/tools/negotiate returns reply + state (mocked pool)', async () => {
    const pool = {
      query: vi.fn(async (text: string) => {
        if (/INSERT INTO delegation_events/.test(text)) {
          return { rows: [] }
        }
        throw new Error(`negotiate mock: ${text.slice(0, 80)}`)
      }),
    } as unknown as Pool
    const mirachat: MirachatSqlContext = {
      pool,
      boss: { send: vi.fn() } as MirachatSqlContext['boss'],
      mirachatIdentity: {} as MirachatSqlContext['mirachatIdentity'],
      mirachatMemory: {} as MirachatSqlContext['mirachatMemory'],
    }
    const server = createServer(
      createDelegateApiListener({ memoryRuntime: createInMemoryRuntime(), mirachat }),
    )
    await new Promise<void>(r => server.listen(0, r))
    const port = (server.address() as import('node:net').AddressInfo).port
    const res = await request(port, {
      method: 'POST',
      path: '/mirachat/tools/negotiate',
      body: JSON.stringify({
        userId: 'u1',
        threadRef: 't-neg',
        counterpartyText: 'Tuesday 2pm works',
        relationshipPriority: 'high',
      }),
    })
    expect(res.status).toBe(200)
    const json = JSON.parse(res.body) as { reply: string; toolsUsed: string[] }
    expect(json.reply.length).toBeGreaterThan(10)
    expect(json.toolsUsed).toContain('propose_slots')
    await new Promise<void>((r, j) => server.close(e => (e ? j(e) : r())))
  })

  it('POST /mirachat/tools/negotiate rejects malformed payloads', async () => {
    const pool = {
      query: vi.fn(async (text: string) => {
        if (/INSERT INTO delegation_events/.test(text)) {
          return { rows: [] }
        }
        throw new Error(`negotiate mock: ${text.slice(0, 80)}`)
      }),
    } as unknown as Pool
    const mirachat: MirachatSqlContext = {
      pool,
      boss: { send: vi.fn() } as MirachatSqlContext['boss'],
      mirachatIdentity: {} as MirachatSqlContext['mirachatIdentity'],
      mirachatMemory: {} as MirachatSqlContext['mirachatMemory'],
    }
    const server = createServer(
      createDelegateApiListener({ memoryRuntime: createInMemoryRuntime(), mirachat }),
    )
    await new Promise<void>(r => server.listen(0, r))
    const port = (server.address() as import('node:net').AddressInfo).port

    const badPriority = await request(port, {
      method: 'POST',
      path: '/mirachat/tools/negotiate',
      body: JSON.stringify({
        threadRef: 't-neg',
        counterpartyText: 'Tuesday works',
        relationshipPriority: 'vip',
      }),
    })
    expect(badPriority.status).toBe(400)

    const badArray = await request(port, {
      method: 'POST',
      path: '/mirachat/tools/negotiate',
      body: JSON.stringify({
        threadRef: 't-neg',
        counterpartyText: 'Tuesday works',
        constraints: ['ok', 42],
      }),
    })
    expect(badArray.status).toBe(400)

    await new Promise<void>((r, j) => server.close(e => (e ? j(e) : r())))
  })

  it('GET /mirachat/doer/openclaw/status exposes configured doer runtime', async () => {
    const openClawDoer = {
      getConfig: vi.fn(() => ({
        openclawDir: '/home/dennis/openclaw',
        openclawEntry: '/home/dennis/openclaw/openclaw.mjs',
        nodeBin: '/usr/local/bin/node22',
        defaultAgentId: 'ops-doer',
        defaultTimeoutSeconds: 180,
      })),
      run: vi.fn(),
    }
    const mirachat: MirachatSqlContext = {
      pool: { query: vi.fn() } as unknown as Pool,
      boss: { send: vi.fn() } as MirachatSqlContext['boss'],
      mirachatIdentity: {} as MirachatSqlContext['mirachatIdentity'],
      mirachatMemory: {} as MirachatSqlContext['mirachatMemory'],
    }
    const server = createServer(
      createDelegateApiListener({
        memoryRuntime: createInMemoryRuntime(),
        mirachat,
        openClawDoer,
      }),
    )
    await new Promise<void>(r => server.listen(0, r))
    const port = (server.address() as import('node:net').AddressInfo).port

    const res = await request(port, { method: 'GET', path: '/mirachat/doer/openclaw/status' })
    expect(res.status).toBe(200)
    const json = JSON.parse(res.body) as {
      provider: string
      configured: boolean
      config: { defaultAgentId?: string }
    }
    expect(json.provider).toBe('openclaw')
    expect(json.configured).toBe(true)
    expect(json.config.defaultAgentId).toBe('ops-doer')

    await new Promise<void>((r, j) => server.close(e => (e ? j(e) : r())))
  })

  it('POST /mirachat/doer/openclaw/run delegates bounded task to OpenClaw doer', async () => {
    const openClawDoer = {
      getConfig: vi.fn(() => ({
        openclawDir: '/home/dennis/openclaw',
        openclawEntry: '/home/dennis/openclaw/openclaw.mjs',
        nodeBin: '/usr/local/bin/node22',
        defaultAgentId: 'ops-doer',
        defaultTimeoutSeconds: 180,
      })),
      run: vi.fn(async () => ({
        ok: true as const,
        cwd: '/home/dennis/openclaw',
        command: ['node22', 'openclaw.mjs', 'agent', '--agent', 'ops-doer'],
        selector: { agentId: 'ops-doer' },
        stdout: '{"result":{"payloads":[{"text":"Done."}]}}',
        stderr: '',
        summary: 'Done.',
        payloads: [{ text: 'Done.' }],
        raw: { result: { payloads: [{ text: 'Done.' }] } },
      })),
    }
    const mirachat: MirachatSqlContext = {
      pool: { query: vi.fn() } as unknown as Pool,
      boss: { send: vi.fn() } as MirachatSqlContext['boss'],
      mirachatIdentity: {} as MirachatSqlContext['mirachatIdentity'],
      mirachatMemory: {} as MirachatSqlContext['mirachatMemory'],
    }
    const server = createServer(
      createDelegateApiListener({
        memoryRuntime: createInMemoryRuntime(),
        mirachat,
        openClawDoer,
      }),
    )
    await new Promise<void>(r => server.listen(0, r))
    const port = (server.address() as import('node:net').AddressInfo).port

    const res = await request(port, {
      method: 'POST',
      path: '/mirachat/doer/openclaw/run',
      body: JSON.stringify({
        task: 'Follow up with the contractor and summarize blockers.',
        agentId: 'ops-doer',
        thinking: 'low',
        timeoutSeconds: 90,
      }),
    })
    expect(res.status).toBe(200)
    const json = JSON.parse(res.body) as { ok: boolean; summary: string }
    expect(json.ok).toBe(true)
    expect(json.summary).toBe('Done.')
    expect(openClawDoer.run).toHaveBeenCalledWith({
      task: 'Follow up with the contractor and summarize blockers.',
      agentId: 'ops-doer',
      sessionId: undefined,
      to: undefined,
      thinking: 'low',
      timeoutSeconds: 90,
      deliver: false,
      channel: undefined,
      replyTo: undefined,
      replyChannel: undefined,
      replyAccount: undefined,
    })

    await new Promise<void>((r, j) => server.close(e => (e ? j(e) : r())))
  })

  it('POST /mirachat/doer/openclaw/run validates task', async () => {
    const openClawDoer = {
      getConfig: vi.fn(() => ({
        openclawDir: '/home/dennis/openclaw',
        openclawEntry: '/home/dennis/openclaw/openclaw.mjs',
        nodeBin: '/usr/local/bin/node22',
        defaultAgentId: 'ops-doer',
        defaultTimeoutSeconds: 180,
      })),
      run: vi.fn(),
    }
    const mirachat: MirachatSqlContext = {
      pool: { query: vi.fn() } as unknown as Pool,
      boss: { send: vi.fn() } as MirachatSqlContext['boss'],
      mirachatIdentity: {} as MirachatSqlContext['mirachatIdentity'],
      mirachatMemory: {} as MirachatSqlContext['mirachatMemory'],
    }
    const server = createServer(
      createDelegateApiListener({
        memoryRuntime: createInMemoryRuntime(),
        mirachat,
        openClawDoer,
      }),
    )
    await new Promise<void>(r => server.listen(0, r))
    const port = (server.address() as import('node:net').AddressInfo).port

    const res = await request(port, {
      method: 'POST',
      path: '/mirachat/doer/openclaw/run',
      body: JSON.stringify({ task: '   ' }),
    })
    expect(res.status).toBe(400)
    expect(openClawDoer.run).not.toHaveBeenCalled()

    await new Promise<void>((r, j) => server.close(e => (e ? j(e) : r())))
  })

  it('POST /mirachat/drafts/:id/approve runs OpenClaw doer and marks draft sent atomically', async () => {
    const baseDraft = {
      id: 'draft-doer-1',
      inbound_message_id: 'in-1',
      generated_text: 'Follow up with the contractor and summarize blockers.',
      confidence_score: 0.82,
      status: 'DRAFTED',
      rule_triggered: 'review',
      edited_text: null,
      approved_at: null,
      sent_at: null,
      channel: 'telegram',
      account_id: 'acct-1',
      user_id: 'demo-user',
      thread_id: 'thread-1',
      intent_summary: 'follow_up; urgency=normal',
      reply_options: null,
      thread_summary: 'Need a follow-up.',
      created_at: new Date(),
      updated_at: new Date(),
    }
    const queryLog: string[] = []
    const pool = {
      query: vi.fn(async (text: string) => {
        queryLog.push(text)
        if (/SELECT \* FROM outbound_drafts WHERE id = \$1/.test(text)) {
          return { rows: [baseDraft] }
        }
        if (/UPDATE outbound_drafts/.test(text) && /SET status = 'SENT'/.test(text)) {
          return {
            rows: [
              {
                ...baseDraft,
                status: 'SENT',
                approved_at: new Date(),
                sent_at: new Date(),
              },
            ],
          }
        }
        if (/INSERT INTO delegation_events/.test(text)) {
          return { rows: [] }
        }
        throw new Error(`approve doer mock: ${text.slice(0, 120)}`)
      }),
    } as unknown as Pool
    const openClawDoer = {
      getConfig: vi.fn(() => ({
        openclawDir: '/home/dennis/openclaw',
        openclawEntry: '/home/dennis/openclaw/openclaw.mjs',
        nodeBin: '/usr/local/bin/node22',
        defaultAgentId: 'ops-doer',
        defaultTimeoutSeconds: 180,
      })),
      run: vi.fn(async () => ({
        ok: true as const,
        cwd: '/home/dennis/openclaw',
        command: ['node22', 'openclaw.mjs', 'agent', '--agent', 'ops-doer'],
        selector: { agentId: 'ops-doer' },
        stdout: '{"result":{"payloads":[{"text":"Done."}]}}',
        stderr: '',
        summary: 'Done.',
        payloads: [{ text: 'Done.' }],
        raw: { result: { payloads: [{ text: 'Done.' }] } },
      })),
    }
    const mirachat: MirachatSqlContext = {
      pool,
      boss: { send: vi.fn() } as MirachatSqlContext['boss'],
      mirachatIdentity: {} as MirachatSqlContext['mirachatIdentity'],
      mirachatMemory: {} as MirachatSqlContext['mirachatMemory'],
    }
    const server = createServer(
      createDelegateApiListener({
        memoryRuntime: createInMemoryRuntime(),
        mirachat,
        openClawDoer,
      }),
    )
    await new Promise<void>(r => server.listen(0, r))
    const port = (server.address() as import('node:net').AddressInfo).port

    const res = await request(port, {
      method: 'POST',
      path: '/mirachat/drafts/draft-doer-1/approve',
      body: JSON.stringify({
        doer: {
          provider: 'openclaw',
          agentId: 'ops-doer',
          thinking: 'low',
        },
      }),
    })
    expect(res.status).toBe(200)
    const json = JSON.parse(res.body) as {
      draft: { status: string }
      doer: { ok: boolean; summary: string }
    }
    expect(json.draft.status).toBe('SENT')
    expect(json.doer.ok).toBe(true)
    expect(json.doer.summary).toBe('Done.')
    expect(openClawDoer.run).toHaveBeenCalledWith({
      task: 'Follow up with the contractor and summarize blockers.',
      agentId: 'ops-doer',
      sessionId: undefined,
      to: undefined,
      thinking: 'low',
      timeoutSeconds: undefined,
      deliver: false,
      channel: undefined,
      replyTo: undefined,
      replyChannel: undefined,
      replyAccount: undefined,
    })
    expect(queryLog.some(text => /SET status = 'APPROVED'/.test(text))).toBe(false)

    await new Promise<void>((r, j) => server.close(e => (e ? j(e) : r())))
  })

  it('POST /mirachat/drafts/:id/approve returns 502 when OpenClaw doer fails and does not mark sent', async () => {
    const baseDraft = {
      id: 'draft-doer-2',
      inbound_message_id: 'in-2',
      generated_text: 'Check the blockers and send a summary.',
      confidence_score: 0.8,
      status: 'DRAFTED',
      rule_triggered: 'review',
      edited_text: null,
      approved_at: null,
      sent_at: null,
      channel: 'telegram',
      account_id: 'acct-1',
      user_id: 'demo-user',
      thread_id: 'thread-2',
      intent_summary: 'delivery; urgency=normal',
      reply_options: null,
      thread_summary: 'Need a status update.',
      created_at: new Date(),
      updated_at: new Date(),
    }
    const queryLog: string[] = []
    const pool = {
      query: vi.fn(async (text: string) => {
        queryLog.push(text)
        if (/SELECT \* FROM outbound_drafts WHERE id = \$1/.test(text)) {
          return { rows: [baseDraft] }
        }
        if (/INSERT INTO delegation_events/.test(text)) {
          return { rows: [] }
        }
        throw new Error(`approve doer failure mock: ${text.slice(0, 120)}`)
      }),
    } as unknown as Pool
    const openClawDoer = {
      getConfig: vi.fn(() => ({
        openclawDir: '/home/dennis/openclaw',
        openclawEntry: '/home/dennis/openclaw/openclaw.mjs',
        nodeBin: '/usr/local/bin/node22',
        defaultAgentId: 'ops-doer',
        defaultTimeoutSeconds: 180,
      })),
      run: vi.fn(async () => {
        throw new Error('OpenClaw doer failed: gateway offline')
      }),
    }
    const mirachat: MirachatSqlContext = {
      pool,
      boss: { send: vi.fn() } as MirachatSqlContext['boss'],
      mirachatIdentity: {} as MirachatSqlContext['mirachatIdentity'],
      mirachatMemory: {} as MirachatSqlContext['mirachatMemory'],
    }
    const server = createServer(
      createDelegateApiListener({
        memoryRuntime: createInMemoryRuntime(),
        mirachat,
        openClawDoer,
      }),
    )
    await new Promise<void>(r => server.listen(0, r))
    const port = (server.address() as import('node:net').AddressInfo).port

    const res = await request(port, {
      method: 'POST',
      path: '/mirachat/drafts/draft-doer-2/approve',
      body: JSON.stringify({
        doer: {
          provider: 'openclaw',
          agentId: 'ops-doer',
        },
      }),
    })
    expect(res.status).toBe(502)
    expect(openClawDoer.run).toHaveBeenCalledOnce()
    expect(queryLog.some(text => /UPDATE outbound_drafts/.test(text))).toBe(false)

    await new Promise<void>((r, j) => server.close(e => (e ? j(e) : r())))
  })

  const openClawDoerStub = {
    getConfig: vi.fn(() => ({
      openclawDir: '/home/dennis/openclaw',
      openclawEntry: '/home/dennis/openclaw/openclaw.mjs',
      nodeBin: '/usr/local/bin/node22',
      defaultAgentId: 'ops-doer',
      defaultTimeoutSeconds: 180,
    })),
    run: vi.fn(),
  }

  const draftForDoerValidation = {
    id: 'draft-doer-validate',
    inbound_message_id: 'in-v',
    generated_text: 'Task body for validation tests.',
    confidence_score: 0.8,
    status: 'DRAFTED',
    rule_triggered: 'review',
    edited_text: null,
    approved_at: null,
    sent_at: null,
    channel: 'telegram',
    account_id: 'acct-1',
    user_id: 'demo-user',
    thread_id: 'thread-v',
    intent_summary: 'delivery',
    reply_options: null,
    thread_summary: 'Summary.',
    created_at: new Date(),
    updated_at: new Date(),
  }

  it('POST /mirachat/drafts/:id/approve returns 400 when doer is not a plain object', async () => {
    const pool = {
      query: vi.fn(async (text: string) => {
        if (/SELECT \* FROM outbound_drafts WHERE id = \$1/.test(text)) {
          return { rows: [draftForDoerValidation] }
        }
        throw new Error(`doer validation mock: ${text.slice(0, 100)}`)
      }),
    } as unknown as Pool
    const mirachat: MirachatSqlContext = {
      pool,
      boss: { send: vi.fn() } as MirachatSqlContext['boss'],
      mirachatIdentity: {} as MirachatSqlContext['mirachatIdentity'],
      mirachatMemory: {} as MirachatSqlContext['mirachatMemory'],
    }
    const server = createServer(
      createDelegateApiListener({
        memoryRuntime: createInMemoryRuntime(),
        mirachat,
        openClawDoer: openClawDoerStub,
      }),
    )
    await new Promise<void>(r => server.listen(0, r))
    const port = (server.address() as import('node:net').AddressInfo).port

    const res = await request(port, {
      method: 'POST',
      path: '/mirachat/drafts/draft-doer-validate/approve',
      body: JSON.stringify({ doer: ['openclaw'] }),
    })
    expect(res.status).toBe(400)
    expect(JSON.parse(res.body).error).toContain('plain object')
    expect(openClawDoerStub.run).not.toHaveBeenCalled()

    await new Promise<void>((r, j) => server.close(e => (e ? j(e) : r())))
  })

  it('POST /mirachat/drafts/:id/approve returns 400 when doer.provider is not openclaw', async () => {
    const pool = {
      query: vi.fn(async (text: string) => {
        if (/SELECT \* FROM outbound_drafts WHERE id = \$1/.test(text)) {
          return { rows: [draftForDoerValidation] }
        }
        throw new Error(`doer provider mock: ${text.slice(0, 100)}`)
      }),
    } as unknown as Pool
    const mirachat: MirachatSqlContext = {
      pool,
      boss: { send: vi.fn() } as MirachatSqlContext['boss'],
      mirachatIdentity: {} as MirachatSqlContext['mirachatIdentity'],
      mirachatMemory: {} as MirachatSqlContext['mirachatMemory'],
    }
    const server = createServer(
      createDelegateApiListener({
        memoryRuntime: createInMemoryRuntime(),
        mirachat,
        openClawDoer: openClawDoerStub,
      }),
    )
    await new Promise<void>(r => server.listen(0, r))
    const port = (server.address() as import('node:net').AddressInfo).port

    const res = await request(port, {
      method: 'POST',
      path: '/mirachat/drafts/draft-doer-validate/approve',
      body: JSON.stringify({ doer: { provider: 'shell', task: 'x' } }),
    })
    expect(res.status).toBe(400)
    expect(JSON.parse(res.body).error).toContain('openclaw')
    expect(openClawDoerStub.run).not.toHaveBeenCalled()

    await new Promise<void>((r, j) => server.close(e => (e ? j(e) : r())))
  })

  it('POST /mirachat/drafts/:id/edit returns 400 when OpenClaw doer has no task text', async () => {
    const pool = {
      query: vi.fn(async (text: string) => {
        if (/SELECT \* FROM outbound_drafts WHERE id = \$1/.test(text)) {
          return { rows: [draftForDoerValidation] }
        }
        throw new Error(`edit doer mock: ${text.slice(0, 100)}`)
      }),
    } as unknown as Pool
    const mirachat: MirachatSqlContext = {
      pool,
      boss: { send: vi.fn() } as MirachatSqlContext['boss'],
      mirachatIdentity: {} as MirachatSqlContext['mirachatIdentity'],
      mirachatMemory: {} as MirachatSqlContext['mirachatMemory'],
    }
    const server = createServer(
      createDelegateApiListener({
        memoryRuntime: createInMemoryRuntime(),
        mirachat,
        openClawDoer: openClawDoerStub,
      }),
    )
    await new Promise<void>(r => server.listen(0, r))
    const port = (server.address() as import('node:net').AddressInfo).port

    const res = await request(port, {
      method: 'POST',
      path: '/mirachat/drafts/draft-doer-validate/edit',
      body: JSON.stringify({
        editedText: '   ',
        doer: { provider: 'openclaw', agentId: 'ops-doer' },
      }),
    })
    expect(res.status).toBe(400)
    expect(JSON.parse(res.body).error).toContain('non-empty task')
    expect(openClawDoerStub.run).not.toHaveBeenCalled()

    await new Promise<void>((r, j) => server.close(e => (e ? j(e) : r())))
  })

  it('POST /mirachat/doer/openclaw/run ignores non-finite timeoutSeconds', async () => {
    const openClawDoer = {
      ...openClawDoerStub,
      run: vi.fn(async () => ({
        ok: true as const,
        cwd: '/tmp',
        command: ['node'],
        selector: {},
        stdout: '',
        stderr: '',
        summary: 'ok',
        payloads: [],
        raw: {},
      })),
    }
    const mirachat: MirachatSqlContext = {
      pool: { query: vi.fn() } as unknown as Pool,
      boss: { send: vi.fn() } as MirachatSqlContext['boss'],
      mirachatIdentity: {} as MirachatSqlContext['mirachatIdentity'],
      mirachatMemory: {} as MirachatSqlContext['mirachatMemory'],
    }
    const server = createServer(
      createDelegateApiListener({
        memoryRuntime: createInMemoryRuntime(),
        mirachat,
        openClawDoer,
      }),
    )
    await new Promise<void>(r => server.listen(0, r))
    const port = (server.address() as import('node:net').AddressInfo).port

    const res = await request(port, {
      method: 'POST',
      path: '/mirachat/doer/openclaw/run',
      body: JSON.stringify({
        task: 'Ping',
        timeoutSeconds: Number.NaN,
      }),
    })
    expect(res.status).toBe(200)
    expect(openClawDoer.run).toHaveBeenCalledWith(
      expect.objectContaining({ task: 'Ping', timeoutSeconds: undefined }),
    )

    await new Promise<void>((r, j) => server.close(e => (e ? j(e) : r())))
  })

  it('A2A propose → respond → inbox (mocked pool)', async () => {
    const envelopeId = 'a2a-env-1'
    const sampleRow = {
      id: envelopeId,
      protocol_version: 'mira-a2a/0.1',
      from_user_id: 'alice',
      to_user_id: 'bob',
      thread_ref: 'thr-1',
      intent: 'handoff',
      payload: { step: 1 },
      response_payload: null,
      status: 'proposed',
      created_at: new Date(),
      updated_at: new Date(),
    }
    const acceptedRow = {
      ...sampleRow,
      status: 'accepted',
      response_payload: { ok: true },
      updated_at: new Date(),
    }
    const pool = {
      query: vi.fn(async (text: string) => {
        if (/INSERT INTO a2a_envelopes/.test(text) && /RETURNING id/.test(text)) {
          return { rows: [{ id: envelopeId }] }
        }
        if (/INSERT INTO delegation_events/.test(text)) {
          return { rows: [] }
        }
        if (/UPDATE a2a_envelopes/.test(text) && /RETURNING \*/.test(text)) {
          return { rows: [acceptedRow] }
        }
        if (/FROM a2a_envelopes WHERE to_user_id/.test(text)) {
          return { rows: [sampleRow] }
        }
        throw new Error(`a2a mock: ${text.slice(0, 90)}`)
      }),
    } as unknown as Pool
    const mirachat: MirachatSqlContext = {
      pool,
      boss: { send: vi.fn() } as MirachatSqlContext['boss'],
      mirachatIdentity: {} as MirachatSqlContext['mirachatIdentity'],
      mirachatMemory: {} as MirachatSqlContext['mirachatMemory'],
    }
    const server = createServer(
      createDelegateApiListener({ memoryRuntime: createInMemoryRuntime(), mirachat }),
    )
    await new Promise<void>(r => server.listen(0, r))
    const port = (server.address() as import('node:net').AddressInfo).port

    const propose = await request(port, {
      method: 'POST',
      path: '/a2a/propose',
      body: JSON.stringify({
        fromUserId: 'alice',
        toUserId: 'bob',
        threadRef: 'thr-1',
        intent: 'handoff',
        payload: { step: 1 },
      }),
    })
    expect(propose.status).toBe(201)
    expect(JSON.parse(propose.body).protocol).toBe('mira-a2a/0.1')

    const respond = await request(port, {
      method: 'POST',
      path: '/a2a/respond',
      body: JSON.stringify({
        envelopeId,
        status: 'accepted',
        responsePayload: { ok: true },
      }),
    })
    expect(respond.status).toBe(200)
    expect(JSON.parse(respond.body).status).toBe('accepted')

    const inbox = await request(port, { method: 'GET', path: '/a2a/inbox?userId=bob&role=to' })
    expect(inbox.status).toBe(200)
    const inboxJson = JSON.parse(inbox.body) as { id: string }[]
    expect(inboxJson[0]!.id).toBe(envelopeId)

    await new Promise<void>((r, j) => server.close(e => (e ? j(e) : r())))
  })

  it('A2A routes reject non-object payloads', async () => {
    const pool = {
      query: vi.fn(async (text: string) => {
        if (/INSERT INTO delegation_events/.test(text)) {
          return { rows: [] }
        }
        throw new Error(`a2a mock: ${text.slice(0, 90)}`)
      }),
    } as unknown as Pool
    const mirachat: MirachatSqlContext = {
      pool,
      boss: { send: vi.fn() } as MirachatSqlContext['boss'],
      mirachatIdentity: {} as MirachatSqlContext['mirachatIdentity'],
      mirachatMemory: {} as MirachatSqlContext['mirachatMemory'],
    }
    const server = createServer(
      createDelegateApiListener({ memoryRuntime: createInMemoryRuntime(), mirachat }),
    )
    await new Promise<void>(r => server.listen(0, r))
    const port = (server.address() as import('node:net').AddressInfo).port

    const propose = await request(port, {
      method: 'POST',
      path: '/a2a/propose',
      body: JSON.stringify({
        fromUserId: 'alice',
        toUserId: 'bob',
        intent: 'handoff',
        payload: ['not', 'allowed'],
      }),
    })
    expect(propose.status).toBe(400)

    const respond = await request(port, {
      method: 'POST',
      path: '/a2a/respond',
      body: JSON.stringify({
        envelopeId: 'env-1',
        status: 'accepted',
        responsePayload: ['bad'],
      }),
    })
    expect(respond.status).toBe(400)

    await new Promise<void>((r, j) => server.close(e => (e ? j(e) : r())))
  })

  it('mini-program bootstrap requires a valid session token', async () => {
    const mirachat: MirachatSqlContext = {
      pool: { query: vi.fn() } as unknown as Pool,
      boss: { send: vi.fn() } as MirachatSqlContext['boss'],
      mirachatIdentity: {} as MirachatSqlContext['mirachatIdentity'],
      mirachatMemory: {} as MirachatSqlContext['mirachatMemory'],
    }
    const server = createServer(
      createDelegateApiListener({ memoryRuntime: createInMemoryRuntime(), mirachat }),
    )
    await new Promise<void>(r => server.listen(0, r))
    const port = (server.address() as import('node:net').AddressInfo).port

    const res = await request(port, { method: 'GET', path: '/mini-program/bootstrap' })
    expect(res.status).toBe(401)

    await new Promise<void>((r, j) => server.close(e => (e ? j(e) : r())))
  })

  it('mini-program draft approve wraps the draft approval flow', async () => {
    const token = createMiniProgramSessionToken('dev-mini-program-secret', {
      openId: 'openid-1',
      unionId: 'union-1',
      userId: 'demo-user',
      exp: Date.now() + 60_000,
    })
    const pool = {
      query: vi.fn(async (text: string) => {
        if (/UPDATE outbound_drafts/.test(text) && /SET status = 'APPROVED'/.test(text)) {
          return {
            rows: [
              {
                id: 'draft-1',
                inbound_message_id: 'in-1',
                generated_text: 'reply',
                confidence_score: 0.8,
                status: 'APPROVED',
                rule_triggered: null,
                edited_text: null,
                approved_at: new Date(),
                sent_at: null,
                channel: 'wechat',
                account_id: 'wechat-account',
                user_id: 'demo-user',
                thread_id: 'thread-1',
                intent_summary: null,
                reply_options: null,
                thread_summary: null,
                created_at: new Date(),
                updated_at: new Date(),
              },
            ],
          }
        }
        if (/INSERT INTO delegation_events/.test(text)) {
          return { rows: [] }
        }
        throw new Error(`mini-program approve mock: ${text.slice(0, 90)}`)
      }),
    } as unknown as Pool
    const mirachat: MirachatSqlContext = {
      pool,
      boss: { send: vi.fn() } as MirachatSqlContext['boss'],
      mirachatIdentity: {} as MirachatSqlContext['mirachatIdentity'],
      mirachatMemory: {} as MirachatSqlContext['mirachatMemory'],
    }
    const server = createServer(
      createDelegateApiListener({ memoryRuntime: createInMemoryRuntime(), mirachat }),
    )
    await new Promise<void>(r => server.listen(0, r))
    const port = (server.address() as import('node:net').AddressInfo).port

    const res = await request(port, {
      method: 'POST',
      path: '/mini-program/drafts/draft-1/approve',
      body: '{}',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(200)
    const json = JSON.parse(res.body) as { ok: boolean; draft: { status: string } }
    expect(json.ok).toBe(true)
    expect(json.draft.status).toBe('APPROVED')

    await new Promise<void>((r, j) => server.close(e => (e ? j(e) : r())))
  })
})
