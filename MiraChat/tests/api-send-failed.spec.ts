import { createServer, request as httpRequest } from 'node:http'
import type { IncomingMessage } from 'node:http'
import type { Pool } from 'pg'
import { describe, expect, it, vi } from 'vitest'
import { createInMemoryRuntime } from '@delegate-ai/agent-core'
import type { MirachatSqlContext } from '../services/api/src/api-listener.ts'
import { createDelegateApiListener } from '../services/api/src/api-listener.ts'

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

describe('Delegate API mark-send-failed route', () => {
  it('records failed sends and dead-letters after max attempts', async () => {
    const delegationInserts: unknown[] = []
    const pool = {
      query: vi.fn(async (text: string, values?: unknown[]) => {
        if (/UPDATE outbound_drafts/.test(text) && /send_attempt_count = send_attempt_count \+ 1/.test(text)) {
          expect(values?.[0]).toBe('draft-1')
          expect(values?.[1]).toBe('twilio exploded')
          expect(values?.[2]).toBe(1)
          return {
            rows: [
              {
                id: 'draft-1',
                inbound_message_id: 'inbound-1',
                generated_text: 'hi',
                confidence_score: 0.9,
                status: 'FAILED',
                rule_triggered: null,
                edited_text: null,
                approved_at: new Date(),
                sent_at: null,
                channel: 'twilio_whatsapp',
                account_id: 'AC123',
                user_id: 'demo-user',
                thread_id: 'whatsapp:+8613651872306',
                intent_summary: 'general',
                reply_options: null,
                thread_summary: null,
                send_attempt_count: 1,
                last_send_attempt_at: new Date(),
                last_send_error: 'twilio exploded',
                next_send_after: null,
                dead_lettered_at: new Date(),
                created_at: new Date(),
                updated_at: new Date(),
              },
            ],
          }
        }
        if (/INSERT INTO delegation_events/.test(text)) {
          delegationInserts.push(values)
          return { rows: [] }
        }
        throw new Error(`Unhandled SQL in mark-send-failed test: ${text.slice(0, 120)}`)
      }),
    } as unknown as Pool

    const listener = createDelegateApiListener({
      memoryRuntime: createInMemoryRuntime(),
      mirachat: {
        pool,
        boss: { send: vi.fn() } as MirachatSqlContext['boss'],
        mirachatIdentity: {} as MirachatSqlContext['mirachatIdentity'],
        mirachatMemory: {} as MirachatSqlContext['mirachatMemory'],
      },
    })
    const server = createServer(listener)
    await new Promise<void>(resolve => server.listen(0, resolve))

    try {
      const port = (server.address() as import('node:net').AddressInfo).port
      const res = await request(port, {
        method: 'POST',
        path: '/mirachat/drafts/draft-1/mark-send-failed',
        body: JSON.stringify({ error: 'twilio exploded', maxAttempts: 1 }),
      })

      expect(res.status).toBe(200)
      expect(JSON.parse(res.body).status).toBe('FAILED')
      expect(delegationInserts.length).toBe(1)
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })
})
