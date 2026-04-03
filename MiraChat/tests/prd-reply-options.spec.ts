import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildReplyOptions, buildThreadSummary, fallbackReplyOptions, shorterDirectFromPrimary } from '@delegate-ai/agent-core'

const boilerplate =
  "Thanks for the message. This lines up with the recent context around Cursor live Twilio test 2026-04-02T03:20:52+00:00. I will follow up with a clear next step shortly. I stay within: no financial commitments, no legal commitments, no irreversible promises."

describe('fallbackReplyOptions / shorterDirectFromPrimary', () => {
  it('produces three pairwise-distinct option texts for long boilerplate draft', () => {
    const opts = fallbackReplyOptions(boilerplate)
    const texts = opts.map((o) => o.text.replace(/\s+/g, ' ').trim().toLowerCase())
    expect(new Set(texts).size).toBe(3)
    expect(texts[0].length).toBeLessThan(texts[1].length)
  })

  it('shorterDirectFromPrimary is strictly shorter than full draft when draft is long', () => {
    const d = shorterDirectFromPrimary(boilerplate)
    expect(d.length).toBeLessThan(boilerplate.length)
    expect(boilerplate.includes(d.slice(0, 20))).toBe(true)
  })
})

const originalFetch = globalThis.fetch
const originalApiKey = process.env.OPENROUTER_API_KEY
const originalTimeout = process.env.OPENROUTER_PRD_TIMEOUT_MS

afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalApiKey == null) delete process.env.OPENROUTER_API_KEY
  else process.env.OPENROUTER_API_KEY = originalApiKey
  if (originalTimeout == null) delete process.env.OPENROUTER_PRD_TIMEOUT_MS
  else process.env.OPENROUTER_PRD_TIMEOUT_MS = originalTimeout
  vi.restoreAllMocks()
})

describe('OpenRouter PRD timeout fallbacks', () => {
  it('buildReplyOptions falls back when OpenRouter hangs', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key'
    process.env.OPENROUTER_PRD_TIMEOUT_MS = '100'
    globalThis.fetch = vi.fn((_, init?: RequestInit) => new Promise((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('AbortError')), { once: true })
    })) as typeof fetch

    const context = {
      identity: { displayName: 'Dennis' },
      relationship: { tone: 'warm', riskLevel: 'normal' },
      event: { text: 'Friday at 4pm is easiest for me. Want to lock that in?' },
      memory: {
        recentMessages: [
          { direction: 'inbound', content: 'Alex wants to reschedule.' },
          { direction: 'memory', content: 'User is free Thursday morning, not Friday.' },
        ],
        searchMatches: [],
      },
    } as Parameters<typeof buildReplyOptions>[0]

    const options = await buildReplyOptions(context, 'Thanks for checking. Thursday morning works better for me.')
    expect(options).toEqual(fallbackReplyOptions('Thanks for checking. Thursday morning works better for me.'))
  })

  it('buildThreadSummary falls back when OpenRouter hangs', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key'
    process.env.OPENROUTER_PRD_TIMEOUT_MS = '100'
    globalThis.fetch = vi.fn((_, init?: RequestInit) => new Promise((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('AbortError')), { once: true })
    })) as typeof fetch

    const transcript = 'Them: Friday at 4pm is easiest for me.\nYou: Thursday morning works better for me.'
    const summary = await buildThreadSummary(transcript)
    expect(summary).toContain('Friday at 4pm is easiest for me')
  })
})
