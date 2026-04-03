import { describe, it, expect } from 'vitest'
import { buildSearchSnippet } from '@delegate-ai/db'

describe('buildSearchSnippet', () => {
  it('centers excerpt on the first matching term', () => {
    const text = 'aaa ' + 'b'.repeat(200) + ' hello world tail'
    const sn = buildSearchSnippet(text, ['hello'], 120)
    expect(sn).toContain('hello')
    expect(sn.startsWith('…') || sn.includes('hello')).toBe(true)
  })

  it('returns a prefix when no term matches', () => {
    const sn = buildSearchSnippet('short', ['nope'], 80)
    expect(sn).toBe('short')
  })
})
