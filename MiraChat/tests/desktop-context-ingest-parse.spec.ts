import { describe, expect, it } from 'vitest'
import { parseDesktopContextIngestRequest } from '../services/api/src/desktop-context.ts'

const tinyPngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lQGTZQAAAABJRU5ErkJggg=='

describe('parseDesktopContextIngestRequest (screenshotImageBase64 for OpenRouter vision)', () => {
  it('accepts raw base64 with image/png', () => {
    const r = parseDesktopContextIngestRequest({
      userId: 'u',
      channel: 'whatsapp',
      threadId: 't',
      summary: 'screenshot',
      screenshotImageBase64: tinyPngBase64,
      screenshotMimeType: 'image/png',
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.screenshotImageBase64).toBe(tinyPngBase64)
      expect(r.value.screenshotMimeType).toBe('image/png')
    }
  })

  it('accepts data URL and infers mime', () => {
    const r = parseDesktopContextIngestRequest({
      userId: 'u',
      channel: 'whatsapp',
      threadId: 't',
      summary: 'screenshot',
      screenshotImageBase64: `data:image/png;base64,${tinyPngBase64}`,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.screenshotImageBase64).toBe(tinyPngBase64)
      expect(r.value.screenshotMimeType).toBe('image/png')
    }
  })
})
