import type { Channel } from '@delegate-ai/adapter-types'
import { inferImageMimeFromBase64, isOpenRouterVisionImageMime, validateOpenRouterImageUrl } from '@delegate-ai/agent-core'

const trimString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

const stringList = (value: unknown): string[] | null => {
  if (value == null) {
    return []
  }
  if (!Array.isArray(value)) {
    return null
  }
  const next = value
    .map(item => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
  return next.length === value.length ? next : null
}

const compactLine = (value: string, max = 3000): string =>
  value.replace(/\s+/g, ' ').trim().slice(0, max)

export interface DesktopWindowMetadata {
  id?: string
  wmClass?: string[]
  wmName?: string | null
  netWmName?: string | null
  pid?: number | null
}

/** ~7.5 MiB binary when decoded; keeps JSON body within typical provider limits. */
export const MAX_SCREENSHOT_IMAGE_BASE64_CHARS = 10_000_000

export interface DesktopContextIngestInput {
  userId: string
  channel: Channel
  accountId?: string
  threadId: string
  contactId?: string
  summary?: string
  extractedText?: string
  screenshotPath?: string
  /** e.g. image/png from browser upload */
  screenshotMimeType?: string
  captureTool?: string
  /**
   * Raw base64 (no `data:` prefix). Sent to OpenRouter vision when `openRouterAnalysis` is true; not persisted in DB.
   */
  screenshotImageBase64?: string
  /** Public HTTPS URL passed to OpenRouter as `image_url.url` (preferred over base64 when both are sent). */
  screenshotImageUrl?: string
  window?: DesktopWindowMetadata
  identityHints: string[]
  relationshipNotes: string[]
  /** When true, API calls OpenRouter (requires OPENROUTER_API_KEY) and stores analysis + optional paste-ready suggested reply as memory chunks (reply is used when drafting later in the thread). */
  openRouterAnalysis: boolean
}

/**
 * Parse optional screenshot bytes for OpenRouter vision. Accepts raw base64 or a full `data:<mime>;base64,...` URL.
 */
export const parseScreenshotImageBase64Field = (
  raw: unknown,
  fallbackMime?: string,
):
  | { ok: true; base64?: string; mime?: string }
  | { ok: false; error: string } => {
  if (raw == null || raw === '') {
    const fb = fallbackMime?.trim()
    return { ok: true, base64: undefined, mime: fb || undefined }
  }
  if (typeof raw !== 'string') {
    return { ok: false, error: 'screenshotImageBase64 must be a string when provided' }
  }
  let payload = raw.replace(/\s+/g, '')
  let mime = (fallbackMime || '').trim()

  if (payload.startsWith('data:')) {
    const m = payload.match(/^data:([\w/+.-]+);base64,(.*)$/i)
    if (!m) {
      return { ok: false, error: 'screenshotImageBase64 data URL must look like data:<mime>;base64,...' }
    }
    mime = m[1].trim()
    payload = m[2].replace(/\s+/g, '')
  }

  if (payload.length === 0) {
    return { ok: true, base64: undefined, mime: mime || undefined }
  }

  if (payload.length > MAX_SCREENSHOT_IMAGE_BASE64_CHARS) {
    return {
      ok: false,
      error: `screenshotImageBase64 exceeds max length (${MAX_SCREENSHOT_IMAGE_BASE64_CHARS} base64 chars)`,
    }
  }
  if (!/^[A-Za-z0-9+/]+=*$/.test(payload)) {
    return { ok: false, error: 'screenshotImageBase64 is not valid base64' }
  }
  if (!mime || !isOpenRouterVisionImageMime(mime)) {
    const inferred = inferImageMimeFromBase64(payload)
    if (inferred) {
      mime = inferred
    }
  }
  if (!mime || !isOpenRouterVisionImageMime(mime)) {
    return {
      ok: false,
      error:
        'screenshotImageBase64 needs a known image type (screenshotMimeType, data: URL, or recognizable PNG/JPEG/GIF/WEBP bytes).',
    }
  }
  return { ok: true, base64: payload, mime: mime.toLowerCase() }
}

export const mergeUniqueStrings = (items: string[], limit = 24): string[] => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of items) {
    const normalized = compactLine(item, 280)
    if (!normalized) {
      continue
    }
    const key = normalized.toLowerCase()
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    out.push(normalized)
    if (out.length >= limit) {
      break
    }
  }
  return out
}

export const parseDesktopContextIngestRequest = (
  body: Record<string, unknown>,
): { ok: true; value: DesktopContextIngestInput } | { ok: false; error: string } => {
  const identityHints = stringList(body.identityHints)
  if (identityHints == null) {
    return { ok: false, error: 'identityHints must be a string array when provided' }
  }
  const relationshipNotes = stringList(body.relationshipNotes)
  if (relationshipNotes == null) {
    return { ok: false, error: 'relationshipNotes must be a string array when provided' }
  }

  const windowRaw = body.window
  if (windowRaw != null && (typeof windowRaw !== 'object' || Array.isArray(windowRaw))) {
    return { ok: false, error: 'window must be a plain object when provided' }
  }
  const windowObj = (windowRaw ?? {}) as Record<string, unknown>
  const wmClass = stringList(windowObj.wmClass)
  if (wmClass == null) {
    return { ok: false, error: 'window.wmClass must be a string array when provided' }
  }

  const userId = trimString(body.userId)
  const channel = trimString(body.channel)
  const threadId = trimString(body.threadId)
  const contactId = trimString(body.contactId)
  const summary = trimString(body.summary)
  const extractedText = trimString(body.extractedText)
  const screenshotPath = trimString(body.screenshotPath)
  const screenshotMimeTypeRaw = trimString(body.screenshotMimeType)
  const screenshotMimeType = screenshotMimeTypeRaw
    ? compactLine(screenshotMimeTypeRaw, 120)
    : undefined
  const captureTool = trimString(body.captureTool)
  const accountId = trimString(body.accountId)

  if (!userId || !channel || !threadId) {
    return { ok: false, error: 'userId, channel, and threadId are required' }
  }

  const openRouterAnalysis = body.openRouterAnalysis === true

  const imgParsed = parseScreenshotImageBase64Field(body.screenshotImageBase64, screenshotMimeType)
  if (!imgParsed.ok) {
    return { ok: false, error: imgParsed.error }
  }
  const screenshotImageBase64 = imgParsed.base64
  const screenshotMimeResolved = imgParsed.mime ?? screenshotMimeType

  let screenshotImageUrl: string | undefined
  const rawImageUrl = trimString(body.screenshotImageUrl)
  if (rawImageUrl) {
    const v = validateOpenRouterImageUrl(rawImageUrl)
    if (!v.ok) {
      return { ok: false, error: v.error }
    }
    screenshotImageUrl = v.url
  }

  const hasRenderableImage = Boolean(screenshotImageUrl) || Boolean(screenshotImageBase64)
  if (!summary && !extractedText && identityHints.length === 0 && relationshipNotes.length === 0 && !hasRenderableImage) {
    return {
      ok: false,
      error:
        'Provide at least one of summary, extractedText, identityHints, relationshipNotes, screenshotImageUrl, or screenshotImageBase64',
    }
  }

  return {
    ok: true,
    value: {
      userId,
      channel: channel as Channel,
      accountId,
      threadId,
      contactId,
      summary: summary ? compactLine(summary, 2000) : undefined,
      extractedText: extractedText ? compactLine(extractedText, 8000) : undefined,
      screenshotPath,
      screenshotMimeType: screenshotMimeResolved,
      captureTool,
      screenshotImageBase64,
      screenshotImageUrl,
      window: {
        id: trimString(windowObj.id),
        wmClass: wmClass ?? [],
        wmName: trimString(windowObj.wmName) ?? null,
        netWmName: trimString(windowObj.netWmName) ?? null,
        pid: typeof windowObj.pid === 'number' && Number.isFinite(windowObj.pid) ? windowObj.pid : null,
      },
      identityHints: mergeUniqueStrings(identityHints, 16),
      relationshipNotes: mergeUniqueStrings(relationshipNotes, 24),
      openRouterAnalysis,
    },
  }
}

export const buildDesktopContextMemoryChunks = (input: DesktopContextIngestInput): string[] => {
  const chunks: string[] = []
  const title = input.window?.netWmName || input.window?.wmName
  const classes = input.window?.wmClass?.length ? input.window.wmClass.join('/') : ''
  const header = [
    `Desktop chat context from ${input.channel}`,
    input.contactId ? `contact=${input.contactId}` : '',
    `thread=${input.threadId}`,
    input.screenshotImageUrl ? `screenshot_url=${compactLine(input.screenshotImageUrl, 500)}` : '',
    input.screenshotPath ? `screenshot=${input.screenshotPath}` : '',
    input.screenshotMimeType ? `attachment_mime=${input.screenshotMimeType}` : '',
    input.captureTool ? `capture_tool=${input.captureTool}` : '',
    title ? `window=${title}` : '',
    classes ? `class=${classes}` : '',
  ]
    .filter(Boolean)
    .join(' | ')

  const body = [
    header,
    input.summary ? `Summary: ${input.summary}` : '',
    input.relationshipNotes.length ? `Relationship notes: ${input.relationshipNotes.join('; ')}` : '',
    input.identityHints.length ? `Identity hints: ${input.identityHints.join('; ')}` : '',
  ]
    .filter(Boolean)
    .join('\n')
  if (body) {
    chunks.push(body)
  }

  if (input.extractedText) {
    chunks.push(
      [
        `Extracted desktop chat text from ${input.channel}`,
        input.contactId ? `contact=${input.contactId}` : '',
        `thread=${input.threadId}`,
        input.extractedText,
      ]
        .filter(Boolean)
        .join('\n'),
    )
  }

  return chunks
}
