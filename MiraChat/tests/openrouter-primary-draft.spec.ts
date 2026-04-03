/**
 * Primary outbound draft for general-domain messages uses OpenRouter when OPENROUTER_API_KEY is set.
 * With primary enabled, analysis-assist is skipped for general inbounds (one model call) unless the
 * inbound is low-signal (short ping) — then analysis runs so imported memory + thread context can ground the draft.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MessageEvent } from '@delegate-ai/adapter-types'
import {
  buildContextBundle,
  buildIngestSuggestedReplyMemoryChunk,
  runCognitivePipeline,
} from '@delegate-ai/agent-core'
import { InMemoryIdentityService } from '@delegate-ai/identity'
import { InMemoryMemoryService } from '@delegate-ai/memory'

const baseEvent = (overrides: Partial<MessageEvent> = {}): MessageEvent => ({
  channel: 'whatsapp',
  accountId: 'acc-1',
  userId: 'user-1',
  senderId: 'contact-1',
  threadId: 'thread-1',
  messageId: `m-${Date.now()}`,
  text: 'Hello there',
  timestamp: Date.now(),
  threadType: 'dm',
  ...overrides,
})

describe('openRouterPrimaryReplyDraft (via runCognitivePipeline)', () => {
  const origKey = process.env.OPENROUTER_API_KEY
  const origPrimary = process.env.OPENROUTER_PRIMARY_DRAFT
  const origForceAnalysis = process.env.OPENROUTER_FORCE_ANALYSIS_ASSIST

  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = 'sk-test-primary-draft'
    delete process.env.OPENROUTER_PRIMARY_DRAFT
    delete process.env.OPENROUTER_FORCE_ANALYSIS_ASSIST
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return {
          ok: true,
          text: async () => '',
          json: async () => ({
            choices: [
              {
                message: {
                  content:
                    'I do not have live market data in this chat—check a finance site or your broker app for today’s headlines; happy to discuss what you find.',
                },
              },
            ],
          }),
        } as Response
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (origKey === undefined) {
      delete process.env.OPENROUTER_API_KEY
    } else {
      process.env.OPENROUTER_API_KEY = origKey
    }
    if (origPrimary === undefined) {
      delete process.env.OPENROUTER_PRIMARY_DRAFT
    } else {
      process.env.OPENROUTER_PRIMARY_DRAFT = origPrimary
    }
    if (origForceAnalysis === undefined) {
      delete process.env.OPENROUTER_FORCE_ANALYSIS_ASSIST
    } else {
      process.env.OPENROUTER_FORCE_ANALYSIS_ASSIST = origForceAnalysis
    }
  })

  it('uses one OpenRouter call for general (primary draft; analysis coalesced)', async () => {
    const identity = new InMemoryIdentityService()
    const memory = new InMemoryMemoryService()
    const event = baseEvent({ text: 'news in stock market today' })
    await memory.recordIncoming(event)
    const ctx = await buildContextBundle({ identityService: identity, memoryService: memory }, event)
    expect(ctx.memory.analysisAssist).toBeNull()
    const draft = await runCognitivePipeline(ctx)
    expect(draft.response).toMatch(/live market data|headlines|broker/i)
    expect(vi.mocked(fetch).mock.calls.length).toBe(1)
  })

  it('uses OpenRouter analysis for scheduling (primary path not used)', async () => {
    const identity = new InMemoryIdentityService()
    const memory = new InMemoryMemoryService()
    const event = baseEvent({ text: 'Can we meet Thursday afternoon?' })
    await memory.recordIncoming(event)
    const ctx = await buildContextBundle({ identityService: identity, memoryService: memory }, event)
    expect(ctx.memory.analysisAssist).toBeTruthy()
    const draft = await runCognitivePipeline(ctx)
    expect(draft.response).toMatch(/coordinate|windows|confirm/i)
    expect(vi.mocked(fetch).mock.calls.length).toBe(1)
  })

  it('OPENROUTER_FORCE_ANALYSIS_ASSIST runs analysis + primary for general (two calls)', async () => {
    process.env.OPENROUTER_FORCE_ANALYSIS_ASSIST = '1'
    let n = 0
    vi.mocked(fetch).mockImplementation(async () => {
      n++
      const content =
        n === 1
          ? '- intent: markets\n- tone: neutral'
          : 'Second call: I cannot fetch live headlines here—please check a finance site.'
      return {
        ok: true,
        text: async () => '',
        json: async () => ({ choices: [{ message: { content } }] }),
      } as Response
    })

    const identity = new InMemoryIdentityService()
    const memory = new InMemoryMemoryService()
    const event = baseEvent({ text: 'stock market news?' })
    await memory.recordIncoming(event)
    const ctx = await buildContextBundle({ identityService: identity, memoryService: memory }, event)
    expect(ctx.memory.analysisAssist).toBeTruthy()
    const draft = await runCognitivePipeline(ctx)
    expect(draft.response).toMatch(/headlines|finance|live/i)
    expect(vi.mocked(fetch).mock.calls.length).toBe(2)
  })

  it('skips OpenRouter primary draft when OPENROUTER_PRIMARY_DRAFT=0', async () => {
    process.env.OPENROUTER_PRIMARY_DRAFT = '0'
    let n = 0
    vi.mocked(fetch).mockImplementation(async () => {
      n++
      return {
        ok: true,
        text: async () => '',
        json: async () => ({
          choices: [{ message: { content: '- intent: general\n- entities: ping' } }],
        }),
      } as Response
    })

    const identity = new InMemoryIdentityService()
    const memory = new InMemoryMemoryService()
    const event = baseEvent({ text: 'quick ping about nothing specific' })
    await memory.recordIncoming(event)
    const ctx = await buildContextBundle({ identityService: identity, memoryService: memory }, event)
    const draft = await runCognitivePipeline(ctx)
    expect(draft.response).not.toMatch(/intent: general/)
    expect(draft.response.length).toBeGreaterThan(10)
    expect(vi.mocked(fetch).mock.calls.length).toBe(1)
  })

  it('low-signal general inbound runs analysis + primary and puts imported memory ahead of latest line', async () => {
    let n = 0
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      n++
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {}
      const userMsg = String(body?.messages?.find((m: { role: string }) => m.role === 'user')?.content || '')
      if (n === 1) {
        return {
          ok: true,
          text: async () => '',
          json: async () => ({
            choices: [{ message: { content: '- intent: update on Twilio account setup' } }],
          }),
        } as Response
      }
      expect(userMsg).toMatch(/Imported thread memory/)
      expect(userMsg).toMatch(/Twilio account management/)
      expect(userMsg.indexOf('Imported thread memory')).toBeLessThan(userMsg.indexOf('Latest message from them'))
      return {
        ok: true,
        text: async () => '',
        json: async () => ({
          choices: [
            {
              message: {
                content:
                  'On Twilio — I can help you pick a number and finish setup; tell me if you want a local or toll-free line.',
              },
            },
          ],
        }),
      } as Response
    })

    const identity = new InMemoryIdentityService()
    const memory = new InMemoryMemoryService()
    vi.spyOn(memory, 'getRecentMessages').mockResolvedValue([
      {
        id: 'mem-twilio',
        channel: 'memory',
        userId: 'user-1',
        senderId: 'user-1',
        threadId: 'thread-1',
        direction: 'inbound',
        content: 'Topic: Twilio account management — user needs a phone number',
        timestamp: 1,
      },
      {
        id: 'm-in',
        channel: 'whatsapp',
        userId: 'user-1',
        senderId: 'contact-1',
        threadId: 'thread-1',
        direction: 'inbound',
        content: 'news',
        timestamp: 2,
      },
    ])
    const event = baseEvent({ text: 'news', messageId: 'm1', timestamp: 3 })
    const ctx = await buildContextBundle({ identityService: identity, memoryService: memory }, event)
    expect(ctx.memory.analysisAssist).toBeTruthy()
    const draft = await runCognitivePipeline(ctx)
    expect(draft.response).toMatch(/Twilio|number|setup/i)
    expect(n).toBe(2)
  })

  it('primary draft user message includes paste-ready ingest block when memory holds suggested reply chunk', async () => {
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {}
      const userMsg = String(body?.messages?.find((m: { role: string }) => m.role === 'user')?.content || '')
      expect(userMsg).toMatch(/Paste-ready reply from your latest screenshot\+text ingest/)
      expect(userMsg).toMatch(/4 total calls/)
      return {
        ok: true,
        text: async () => '',
        json: async () => ({
          choices: [
            {
              message: {
                content:
                  'Yep — Voice Insights shows 4 total calls in the last 7 days; all completed as busy with zero talk time.',
              },
            },
          ],
        }),
      } as Response
    })

    const identity = new InMemoryIdentityService()
    const memory = new InMemoryMemoryService()
    const chunk = buildIngestSuggestedReplyMemoryChunk({
      channel: 'whatsapp',
      threadId: 'thread-1',
      reply: 'Per the dashboard: 4 total calls in the last 7 days, all busy / no talk time.',
    })
    vi.spyOn(memory, 'getRecentMessages').mockResolvedValue([
      {
        id: 'mem-sr',
        channel: 'memory',
        userId: 'user-1',
        senderId: 'user-1',
        threadId: 'thread-1',
        direction: 'inbound',
        content: chunk,
        timestamp: 1,
      },
      {
        id: 'm-in',
        channel: 'whatsapp',
        userId: 'user-1',
        senderId: 'contact-1',
        threadId: 'thread-1',
        direction: 'inbound',
        content: 'how many calls were placed?',
        timestamp: 2,
      },
    ])
    const event = baseEvent({ text: 'how many calls were placed?', messageId: 'm1', timestamp: 3 })
    const ctx = await buildContextBundle({ identityService: identity, memoryService: memory }, event)
    const draft = await runCognitivePipeline(ctx)
    expect(draft.response).toMatch(/4|calls|busy/i)
    expect(vi.mocked(fetch).mock.calls.length).toBe(1)
  })
})
