import { describe, expect, it } from 'vitest'
import { inferImageMimeFromBase64 } from '@delegate-ai/agent-core'

const tinyPngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lQGTZQAAAABJRU5ErkJggg=='

describe('inferImageMimeFromBase64', () => {
  it('detects PNG', () => {
    expect(inferImageMimeFromBase64(tinyPngBase64)).toBe('image/png')
  })

  it('returns undefined for empty', () => {
    expect(inferImageMimeFromBase64('')).toBeUndefined()
  })
})
