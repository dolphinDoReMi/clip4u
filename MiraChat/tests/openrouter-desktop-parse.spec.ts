import { describe, expect, it } from 'vitest'
import { parseOpenRouterDesktopContextJson } from '@delegate-ai/agent-core'

describe('parseOpenRouterDesktopContextJson', () => {
  it('parses bare JSON object', () => {
    const r = parseOpenRouterDesktopContextJson(
      '{"analysis":"- a\\n- b","suggestedReply":"hey there"}',
    )
    expect(r.whatISee).toBe('')
    expect(r.analysis).toBe('- a\n- b')
    expect(r.suggestedReply).toBe('hey there')
    expect(r.contactAvatarIdentified).toBe(false)
  })

  it('prepends whatISee into analysis when present', () => {
    const r = parseOpenRouterDesktopContextJson(
      '{"whatISee":"Dark UI with a header.","analysis":"- topic: x","suggestedReply":"ok"}',
    )
    expect(r.whatISee).toBe('Dark UI with a header.')
    expect(r.analysis).toBe('What I see:\nDark UI with a header.\n\n- topic: x')
    expect(r.suggestedReply).toBe('ok')
  })

  it('accepts visualDescription alias', () => {
    const r = parseOpenRouterDesktopContextJson(
      '{"visualDescription":"Two panels.","analysis":"- a","suggestedReply":"y"}',
    )
    expect(r.whatISee).toBe('Two panels.')
    expect(r.analysis).toContain('What I see:\nTwo panels.')
  })

  it('extracts reasoningTrace without merging into analysis', () => {
    const r = parseOpenRouterDesktopContextJson(
      '{"whatISee":"","analysis":"- one","reasoningTrace":"check order","suggestedReply":"ok"}',
    )
    expect(r.reasoningTrace).toBe('check order')
    expect(r.analysis).toBe('- one')
    expect(r.analysis).not.toMatch(/check order/)
  })

  it('strips markdown fence', () => {
    const r = parseOpenRouterDesktopContextJson(
      '```json\n{"analysis":"x","suggestedReply":"ok"}\n```',
    )
    expect(r.whatISee).toBe('')
    expect(r.analysis).toBe('x')
    expect(r.suggestedReply).toBe('ok')
    expect(r.contactAvatarIdentified).toBe(false)
  })

  it('falls back to full string as analysis when JSON invalid', () => {
    const raw = '- bullet only'
    const r = parseOpenRouterDesktopContextJson(raw)
    expect(r.whatISee).toBe('')
    expect(r.analysis).toBe(raw)
    expect(r.suggestedReply).toBeNull()
    expect(r.contactAvatarIdentified).toBe(false)
  })

  it('keeps suggestedReply when analysis is empty string in JSON', () => {
    const r = parseOpenRouterDesktopContextJson('{"analysis":"","suggestedReply":"sure, Thursday works"}')
    expect(r.whatISee).toBe('')
    expect(r.analysis).toBe('')
    expect(r.suggestedReply).toBe('sure, Thursday works')
    expect(r.contactAvatarIdentified).toBe(false)
  })

  it('parses JSON embedded after preamble text', () => {
    const r = parseOpenRouterDesktopContextJson(
      'Here you go:\n{"analysis":"- one","suggestedReply":"ok cool"}',
    )
    expect(r.whatISee).toBe('')
    expect(r.analysis).toBe('- one')
    expect(r.suggestedReply).toBe('ok cool')
  })

  it('accepts snake_case suggested_reply', () => {
    const r = parseOpenRouterDesktopContextJson('{"analysis":"x","suggested_reply":"ping"}')
    expect(r.suggestedReply).toBe('ping')
    expect(r.contactAvatarIdentified).toBe(false)
  })

  it('parses contactAvatarIdentified when true', () => {
    const r = parseOpenRouterDesktopContextJson(
      '{"analysis":"- hi","suggestedReply":"ok","contactAvatarIdentified":true}',
    )
    expect(r.contactAvatarIdentified).toBe(true)
  })

  it('parses contact_avatar_identified snake_case', () => {
    const r = parseOpenRouterDesktopContextJson(
      '{"analysis":"x","suggestedReply":"y","contact_avatar_identified":true}',
    )
    expect(r.contactAvatarIdentified).toBe(true)
  })
})
