import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildDataUrlForOpenRouterVision,
  buildOpenRouterMultimodalUserContent,
  isOpenRouterVisionModelAllowed,
  parseOpenRouterChatCompletionContent,
  validateOpenRouterImageUrl,
  validateVisionBase64PayloadLength,
} from '@delegate-ai/agent-core'

describe('openrouter-vision-schema', () => {
  it('buildOpenRouterMultimodalUserContent: text then image_url (URL)', () => {
    const parts = buildOpenRouterMultimodalUserContent({
      text: 'Analyze this.',
      imageUrl: 'https://example.com/a.jpg',
    })
    expect(parts).toEqual([
      { type: 'text', text: 'Analyze this.' },
      { type: 'image_url', image_url: { url: 'https://example.com/a.jpg' } },
    ])
  })

  it('buildOpenRouterMultimodalUserContent: prefers URL over dataUrl when both passed', () => {
    const parts = buildOpenRouterMultimodalUserContent({
      text: 'x',
      imageUrl: 'https://x.test/img.png',
      dataUrl: 'data:image/png;base64,abc',
    })
    expect(parts[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'https://x.test/img.png' },
    })
  })

  it('buildOpenRouterMultimodalUserContent: data URL uses detail auto', () => {
    const parts = buildOpenRouterMultimodalUserContent({
      text: 'x',
      dataUrl: 'data:image/jpeg;base64,xx',
    })
    expect(parts[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/jpeg;base64,xx', detail: 'auto' },
    })
  })

  it('buildDataUrlForOpenRouterVision strips accidental data URL prefix', () => {
    const u = buildDataUrlForOpenRouterVision(
      'image/png',
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
    )
    expect(u).toBe('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB')
  })

  it('validateOpenRouterImageUrl accepts https', () => {
    expect(validateOpenRouterImageUrl('  https://cdn.example/x.png  ')).toEqual({
      ok: true,
      url: 'https://cdn.example/x.png',
    })
  })

  it('validateOpenRouterImageUrl rejects non-https without env', () => {
    expect(validateOpenRouterImageUrl('http://evil.com/x.png').ok).toBe(false)
  })

  it('validateVisionBase64PayloadLength rejects oversized', () => {
    expect(validateVisionBase64PayloadLength(6_000_000, 5_000_000).ok).toBe(false)
  })

  it('parseOpenRouterChatCompletionContent validates shape', () => {
    expect(
      parseOpenRouterChatCompletionContent({
        choices: [{ message: { content: '  hello  ' } }],
      }),
    ).toBe('hello')
    expect(parseOpenRouterChatCompletionContent({ choices: [] })).toBeNull()
    expect(parseOpenRouterChatCompletionContent({})).toBeNull()
  })

  it('parseOpenRouterChatCompletionContent joins multimodal assistant content array', () => {
    expect(
      parseOpenRouterChatCompletionContent({
        choices: [
          {
            message: {
              content: [
                { type: 'text', text: 'Part A' },
                { type: 'text', text: 'Part B' },
              ],
            },
          },
        ],
      }),
    ).toBe('Part A\nPart B')
  })

  it('isOpenRouterVisionModelAllowed recognizes gpt-4o-mini', () => {
    expect(isOpenRouterVisionModelAllowed('openai/gpt-4o-mini')).toBe(true)
  })

  it('OPENROUTER_SKIP_VISION_MODEL_CHECK bypasses heuristic', () => {
    vi.stubEnv('OPENROUTER_SKIP_VISION_MODEL_CHECK', '1')
    expect(isOpenRouterVisionModelAllowed('some/unknown-text-model')).toBe(true)
    vi.unstubAllEnvs()
  })
})
