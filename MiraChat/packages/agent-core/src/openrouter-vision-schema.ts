/**
 * OpenRouter Chat Completions multimodal user message shape (OpenAI-compatible).
 * @see https://openrouter.ai/docs — content: [{ type: "text", text }, { type: "image_url", image_url: { url } }]
 */

/** Max base64 character count for a single vision image (decoded payload is ~3/4 of this). */
export const OPENROUTER_VISION_MAX_BASE64_CHARS_DEFAULT = 5_000_000

export type OpenRouterTextContentPart = { type: 'text'; text: string }

export type OpenRouterImageUrlContentPart = {
  type: 'image_url'
  image_url: { url: string; detail?: 'auto' | 'low' | 'high' }
}

export type OpenRouterMultimodalUserContentPart = OpenRouterTextContentPart | OpenRouterImageUrlContentPart

/**
 * Build user `content` array: text first, then image (OpenRouter / OpenAI multimodal convention).
 * Prefer `https` URL over data URLs when both are available (smaller, faster).
 */
export function buildOpenRouterMultimodalUserContent(input: {
  text: string
  imageUrl?: string | null
  dataUrl?: string | null
}): OpenRouterMultimodalUserContentPart[] {
  const text = input.text.trim() || '(no additional text)'
  const parts: OpenRouterMultimodalUserContentPart[] = [{ type: 'text', text }]

  const url = input.imageUrl?.trim()
  if (url) {
    parts.push({ type: 'image_url', image_url: { url } })
    return parts
  }

  const dataUrl = input.dataUrl?.trim()
  if (dataUrl) {
    parts.push({ type: 'image_url', image_url: { url: dataUrl, detail: 'auto' } })
  }

  return parts
}

export function buildDataUrlForOpenRouterVision(mime: string, rawBase64: string): string {
  const b64 = rawBase64.replace(/^data:[^;]+;base64,/i, '').replace(/\s+/g, '')
  const m = mime.trim().toLowerCase()
  return `data:${m};base64,${b64}`
}

/** Validate public image URL for OpenRouter `image_url.url` (HTTPS; optional localhost HTTP for dev). */
export function validateOpenRouterImageUrl(raw: string): { ok: true; url: string } | { ok: false; error: string } {
  const u = raw.trim()
  if (!u) {
    return { ok: false, error: 'image URL is empty' }
  }
  if (u.length > 4096) {
    return { ok: false, error: 'image URL exceeds max length (4096)' }
  }
  if (/^https:\/\//i.test(u)) {
    return { ok: true, url: u }
  }
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(u)) {
    const allow = process.env.OPENROUTER_ALLOW_HTTP_IMAGE_URL?.trim().toLowerCase()
    if (allow === '1' || allow === 'true' || allow === 'yes') {
      return { ok: true, url: u }
    }
    return {
      ok: false,
      error:
        'http://localhost image URLs require OPENROUTER_ALLOW_HTTP_IMAGE_URL=1 (OpenRouter may still reject non-public URLs)',
    }
  }
  return { ok: false, error: 'image URL must start with https:// (or http://localhost with OPENROUTER_ALLOW_HTTP_IMAGE_URL=1)' }
}

export function validateVisionBase64PayloadLength(
  base64CharCount: number,
  maxChars = Number(process.env.OPENROUTER_VISION_MAX_BASE64_CHARS) || OPENROUTER_VISION_MAX_BASE64_CHARS_DEFAULT,
): { ok: true } | { ok: false; error: string } {
  if (base64CharCount <= maxChars) {
    return { ok: true }
  }
  return {
    ok: false,
    error: `vision base64 payload too large (${base64CharCount} chars; max ${maxChars}). Prefer screenshotImageUrl (HTTPS) or reduce image size.`,
  }
}

/**
 * Heuristic: model id is likely to accept image_url parts on OpenRouter.
 * Override with OPENROUTER_VISION_MODEL_ALLOWLIST=comma-separated prefixes or exact ids.
 */
export function isOpenRouterVisionModelAllowed(model: string): boolean {
  const skip = process.env.OPENROUTER_SKIP_VISION_MODEL_CHECK?.trim().toLowerCase()
  if (skip === '1' || skip === 'true' || skip === 'yes') {
    return true
  }
  const m = model.trim()
  if (!m) {
    return false
  }
  const list = process.env.OPENROUTER_VISION_MODEL_ALLOWLIST?.trim()
  if (list) {
    const parts = list
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
    return parts.some(p => m === p || m.startsWith(p))
  }
  const lower = m.toLowerCase()
  const hints = [
    'gpt-4o',
    'gpt-4.1',
    'gpt-4-turbo',
    'o4',
    'claude-3',
    'claude-sonnet-4',
    'gemini',
    'llava',
    'qwen-vl',
    'qwen2-vl',
    'qwen3-vl',
    'vision',
    'multimodal',
  ]
  return hints.some(h => lower.includes(h))
}

/** Validate OpenRouter chat/completions JSON: choices[0].message.content is a non-empty string. */
export function parseOpenRouterChatCompletionContent(data: unknown): string | null {
  if (data === null || typeof data !== 'object') {
    return null
  }
  const choices = (data as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) {
    return null
  }
  const first = choices[0]
  if (first === null || typeof first !== 'object') {
    return null
  }
  const message = (first as { message?: unknown }).message
  if (message === null || typeof message !== 'object') {
    return null
  }
  const content = (message as { content?: unknown }).content
  if (typeof content === 'string') {
    const t = content.trim()
    return t.length > 0 ? t : null
  }
  if (Array.isArray(content)) {
    const textParts = content
      .filter((p): p is { type?: string; text?: string } => p !== null && typeof p === 'object')
      .filter(p => p.type === 'text' && typeof p.text === 'string')
      .map(p => p.text!.trim())
      .filter(Boolean)
    const joined = textParts.join('\n').trim()
    return joined.length > 0 ? joined : null
  }
  return null
}
