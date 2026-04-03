/**
 * Phone outbound routes with mocked Twilio package + SQL pool.
 */
import { createServer, request as httpRequest } from 'node:http'
import type { IncomingMessage } from 'node:http'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Pool } from 'pg'
import { createInMemoryRuntime } from '@delegate-ai/agent-core'
import {
  createDelegateApiListener,
  type MirachatSqlContext,
} from '../services/api/src/api-listener.ts'

const { placeOutboundNotifyCall, resolveTwilioVoiceConfigFromEnv } = vi.hoisted(() => {
  const placeOutboundNotifyCall = vi.fn(async () => ({ callSid: 'CA_test_sid', status: 'queued' }))
  const resolveTwilioVoiceConfigFromEnv = vi.fn(() => ({
    accountSid: 'AC_test',
    authToken: 'token',
    fromNumber: '+15550001234',
  }))
  return { placeOutboundNotifyCall, resolveTwilioVoiceConfigFromEnv }
})

vi.mock('@delegate-ai/twilio-voice-notify', () => ({
  placeOutboundNotifyCall,
  resolveTwilioVoiceConfigFromEnv,
}))

const request = (
  port: number,
  opts: { method: string; path: string; body?: string; headers?: Record<string, string> },
): Promise<{ status: number; body: string }> =>
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
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') })
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

describe('Phone outbound API', () => {
  let prevSecret: string | undefined

  beforeEach(() => {
    prevSecret = process.env.MIRACHAT_PHONE_OUTBOUND_SECRET
    delete process.env.MIRACHAT_PHONE_OUTBOUND_SECRET
    vi.clearAllMocks()
    resolveTwilioVoiceConfigFromEnv.mockReturnValue({
      accountSid: 'AC_test',
      authToken: 'token',
      fromNumber: '+15550001234',
    })
    placeOutboundNotifyCall.mockResolvedValue({ callSid: 'CA_test_sid', status: 'queued' })
  })

  afterEach(() => {
    if (prevSecret === undefined) {
      delete process.env.MIRACHAT_PHONE_OUTBOUND_SECRET
    } else {
      process.env.MIRACHAT_PHONE_OUTBOUND_SECRET = prevSecret
    }
  })

  const poolStub = (): Pool =>
    ({
      query: vi.fn(async (text: string) => {
        if (/INSERT INTO delegation_events/.test(text)) {
          return { rows: [] }
        }
        throw new Error(`unexpected query: ${text.slice(0, 80)}`)
      }),
    }) as unknown as Pool

  it('GET /mirachat/phone/status reflects Twilio config', async () => {
    const mirachat: MirachatSqlContext = {
      pool: poolStub(),
      boss: { send: vi.fn() } as MirachatSqlContext['boss'],
      mirachatIdentity: {} as MirachatSqlContext['mirachatIdentity'],
      mirachatMemory: {} as MirachatSqlContext['mirachatMemory'],
    }
    const server = createServer(
      createDelegateApiListener({ memoryRuntime: createInMemoryRuntime(), mirachat }),
    )
    await new Promise<void>(r => server.listen(0, r))
    const port = (server.address() as import('node:net').AddressInfo).port
    const res = await request(port, { method: 'GET', path: '/mirachat/phone/status' })
    expect(res.status).toBe(200)
    const json = JSON.parse(res.body) as {
      configured: boolean
      fromMasked: string
      voiceStatusCallbackConfigured: boolean
    }
    expect(json.configured).toBe(true)
    expect(json.fromMasked).toContain('***')
    expect(json.voiceStatusCallbackConfigured).toBe(false)
    await new Promise<void>((r, j) => server.close(e => (e ? j(e) : r())))
  })

  it('GET /mirachat/runtime-config exposes Twilio defaults for the ops console', async () => {
    const prevSid = process.env.TWILIO_ACCOUNT_SID
    const prevWhatsappFrom = process.env.TWILIO_WHATSAPP_FROM
    try {
      process.env.TWILIO_ACCOUNT_SID = 'AC_runtime_test'
      process.env.TWILIO_WHATSAPP_FROM = 'whatsapp:+15550009999'
      const mirachat: MirachatSqlContext = {
        pool: poolStub(),
        boss: { send: vi.fn() } as MirachatSqlContext['boss'],
        mirachatIdentity: {} as MirachatSqlContext['mirachatIdentity'],
        mirachatMemory: {} as MirachatSqlContext['mirachatMemory'],
      }
      const server = createServer(
        createDelegateApiListener({ memoryRuntime: createInMemoryRuntime(), mirachat }),
      )
      await new Promise<void>(r => server.listen(0, r))
      const port = (server.address() as import('node:net').AddressInfo).port
      const res = await request(port, { method: 'GET', path: '/mirachat/runtime-config' })
      expect(res.status).toBe(200)
      const json = JSON.parse(res.body) as {
        defaults: {
          twilio_whatsapp: { accountId: string; sender: string }
        }
      }
      expect(json.defaults.twilio_whatsapp.accountId).toBe('AC_runtime_test')
      expect(json.defaults.twilio_whatsapp.sender).toBe('whatsapp:+15550009999')
      await new Promise<void>((r, j) => server.close(e => (e ? j(e) : r())))
    } finally {
      if (prevSid === undefined) {
        delete process.env.TWILIO_ACCOUNT_SID
      } else {
        process.env.TWILIO_ACCOUNT_SID = prevSid
      }
      if (prevWhatsappFrom === undefined) {
        delete process.env.TWILIO_WHATSAPP_FROM
      } else {
        process.env.TWILIO_WHATSAPP_FROM = prevWhatsappFrom
      }
    }
  })

  it('POST /mirachat/webhooks/twilio/voice-call-status records STIR fields when signature skipped', async () => {
    const prevSkip = process.env.MIRACHAT_SKIP_TWILIO_VOICE_WEBHOOK_SIGNATURE
    process.env.MIRACHAT_SKIP_TWILIO_VOICE_WEBHOOK_SIGNATURE = '1'
    const inserts: string[] = []
    const poolStub2 = (): Pool =>
      ({
        query: vi.fn(async (text: string, params?: unknown[]) => {
          if (/INSERT INTO delegation_events/.test(text)) {
            inserts.push(String(params?.[0]))
            return { rows: [] }
          }
          throw new Error(`unexpected query: ${text.slice(0, 80)}`)
        }),
      }) as unknown as Pool
    const mirachat: MirachatSqlContext = {
      pool: poolStub2(),
      boss: { send: vi.fn() } as MirachatSqlContext['boss'],
      mirachatIdentity: {} as MirachatSqlContext['mirachatIdentity'],
      mirachatMemory: {} as MirachatSqlContext['mirachatMemory'],
    }
    const server = createServer(
      createDelegateApiListener({ memoryRuntime: createInMemoryRuntime(), mirachat }),
    )
    await new Promise<void>(r => server.listen(0, r))
    const port = (server.address() as import('node:net').AddressInfo).port
    const form =
      'CallSid=CA_x&CallStatus=completed&To=%2B1&From=%2B2&StirVerstat=TN-Validation-Passed-A'
    const res = await request(port, {
      method: 'POST',
      path: '/mirachat/webhooks/twilio/voice-call-status',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': String(Buffer.byteLength(form)) },
      body: form,
    })
    expect(res.status).toBe(200)
    expect(res.body).toContain('<Response')
    expect(inserts.some(e => e.includes('phone.twilio.call_status'))).toBe(true)
    await new Promise<void>((r, j) => server.close(e => (e ? j(e) : r())))
    if (prevSkip === undefined) {
      delete process.env.MIRACHAT_SKIP_TWILIO_VOICE_WEBHOOK_SIGNATURE
    } else {
      process.env.MIRACHAT_SKIP_TWILIO_VOICE_WEBHOOK_SIGNATURE = prevSkip
    }
  })

  it('POST /mirachat/phone/outbound validates E.164', async () => {
    const mirachat: MirachatSqlContext = {
      pool: poolStub(),
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
      path: '/mirachat/phone/outbound',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 'u1', to: '5551234', message: 'Hi' }),
    })
    expect(res.status).toBe(400)
    expect(placeOutboundNotifyCall).not.toHaveBeenCalled()
    await new Promise<void>((r, j) => server.close(e => (e ? j(e) : r())))
  })

  it('POST /mirachat/phone/outbound places call and returns sid', async () => {
    const mirachat: MirachatSqlContext = {
      pool: poolStub(),
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
      path: '/mirachat/phone/outbound',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        userId: 'u1',
        to: '+15557654321',
        message: 'Hello from MiraChat voice notify.',
        disclosureMode: 'neutral',
      }),
    })
    expect(res.status).toBe(200)
    const json = JSON.parse(res.body) as { callSid: string }
    expect(json.callSid).toBe('CA_test_sid')
    expect(placeOutboundNotifyCall).toHaveBeenCalledOnce()
    await new Promise<void>((r, j) => server.close(e => (e ? j(e) : r())))
  })

  it('POST /mirachat/phone/outbound requires secret when MIRACHAT_PHONE_OUTBOUND_SECRET is set', async () => {
    process.env.MIRACHAT_PHONE_OUTBOUND_SECRET = 'supersecret'
    const mirachat: MirachatSqlContext = {
      pool: poolStub(),
      boss: { send: vi.fn() } as MirachatSqlContext['boss'],
      mirachatIdentity: {} as MirachatSqlContext['mirachatIdentity'],
      mirachatMemory: {} as MirachatSqlContext['mirachatMemory'],
    }
    const server = createServer(
      createDelegateApiListener({ memoryRuntime: createInMemoryRuntime(), mirachat }),
    )
    await new Promise<void>(r => server.listen(0, r))
    const port = (server.address() as import('node:net').AddressInfo).port
    const denied = await request(port, {
      method: 'POST',
      path: '/mirachat/phone/outbound',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: 'u1', to: '+15557654321', message: 'Hi' }),
    })
    expect(denied.status).toBe(403)

    const ok = await request(port, {
      method: 'POST',
      path: '/mirachat/phone/outbound',
      headers: {
        'content-type': 'application/json',
        'x-mirachat-phone-secret': 'supersecret',
      },
      body: JSON.stringify({ userId: 'u1', to: '+15557654321', message: 'Hi' }),
    })
    expect(ok.status).toBe(200)
    await new Promise<void>((r, j) => server.close(e => (e ? j(e) : r())))
  })
})
