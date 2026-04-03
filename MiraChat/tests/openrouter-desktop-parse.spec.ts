import { describe, expect, it } from 'vitest'
import { parseOpenRouterDesktopContextJson } from '@delegate-ai/agent-core'

describe('parseOpenRouterDesktopContextJson', () => {
  it('parses bare JSON object', () => {
    const r = parseOpenRouterDesktopContextJson(
      '{"analysis":"- a\\n- b","suggestedReply":"hey there"}',
    )
    expect(r.analysis).toBe('- a\n- b')
    expect(r.suggestedReply).toBe('hey there')
  })

  it('strips markdown fence', () => {
    const r = parseOpenRouterDesktopContextJson(
      '```json\n{"analysis":"x","suggestedReply":"ok"}\n```',
    )
    expect(r.analysis).toBe('x')
    expect(r.suggestedReply).toBe('ok')
  })

  it('falls back to full string as analysis when JSON invalid', () => {
    const raw = '- bullet only'
    const r = parseOpenRouterDesktopContextJson(raw)
    expect(r.analysis).toBe(raw)
    expect(r.suggestedReply).toBeNull()
  })
})
