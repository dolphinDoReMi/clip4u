import { describe, expect, it } from 'vitest'
import { fallbackReplyOptions, shorterDirectFromPrimary } from '@delegate-ai/agent-core'

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
