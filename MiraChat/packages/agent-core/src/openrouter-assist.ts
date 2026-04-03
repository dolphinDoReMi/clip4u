const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

const truncate = (s: string, max: number): string => {
  if (s.length <= max) {
    return s
  }
  return `${s.slice(0, max)}\n…`
}

const formatMessages = (label: string, messages: { threadId: string; direction: string; content: string }[]): string => {
  if (messages.length === 0) {
    return `${label}: (none)`
  }
  return `${label}:\n${messages
    .map(m => `[${m.direction} ${m.threadId.slice(0, 12)}…] ${m.content}`)
    .join('\n')}`
}

export interface OpenRouterAnalysisInput {
  latestUserText: string
  recentMessages: { threadId: string; direction: string; content: string }[]
  searchMatches: { threadId: string; direction: string; content: string }[]
}

/**
 * Optional chat-model assist (e.g. GLM via OpenRouter) for intent/context analysis only.
 * Set OPENROUTER_API_KEY; OPENROUTER_MODEL defaults to a GLM-class route on OpenRouter.
 */
export async function openRouterAnalysisAssist(input: OpenRouterAnalysisInput): Promise<string | null> {
  const key = process.env.OPENROUTER_API_KEY?.trim()
  if (!key) {
    return null
  }

  const model =
    process.env.OPENROUTER_MODEL?.trim() ||
    'openai/gpt-4o-mini'

  const threadExcerpt = truncate(
    formatMessages('Current thread', input.recentMessages),
    12000,
  )
  const searchExcerpt = truncate(
    formatMessages('Search hits (other threads / history)', input.searchMatches),
    12000,
  )

  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(process.env.OPENROUTER_HTTP_REFERER
        ? { 'HTTP-Referer': process.env.OPENROUTER_HTTP_REFERER }
        : {}),
      'X-Title': 'MiraChat analysis assist',
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content:
            'You help a bounded communication delegate. Output 3–8 short bullet lines: intent, entities, tone, risks, and what the human should consider. Do not write the reply message itself.',
        },
        {
          role: 'user',
          content: `Latest inbound:\n${truncate(input.latestUserText, 8000)}\n\n${threadExcerpt}\n\n${searchExcerpt}`,
        },
      ],
      max_tokens: 500,
      temperature: 0.2,
    }),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    console.error('OpenRouter analysis assist failed', res.status, errText)
    return null
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  const text = data.choices?.[0]?.message?.content?.trim()
  return text || null
}

export interface OpenRouterDesktopContextInput {
  channel: string
  threadId: string
  contactId?: string
  summary?: string
  extractedText?: string
  identityHints: string[]
  relationshipNotes: string[]
  windowTitle?: string
  windowClass?: string[]
  /** Raw base64 (no data URL). When set with image/* screenshotMimeType, sent to OpenRouter as vision input. */
  screenshotImageBase64?: string
  /** Required for vision when screenshotImageBase64 is set, e.g. image/png */
  screenshotMimeType?: string
}

/** Parsed model output for desktop ingest (analysis bullets + one paste-ready reply). */
export interface OpenRouterDesktopContextResult {
  analysis: string
  suggestedReply: string | null
}

const stripJsonFence = (raw: string): string => {
  const t = raw.trim()
  if (!t.startsWith('```')) {
    return t
  }
  return t
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/u, '')
    .trim()
}

/**
 * Parse JSON object from model; on failure treat entire string as analysis only.
 * Exported for tests.
 */
export function parseOpenRouterDesktopContextJson(raw: string): OpenRouterDesktopContextResult {
  const trimmed = raw.trim()
  if (!trimmed) {
    return { analysis: '', suggestedReply: null }
  }
  try {
    const o = JSON.parse(stripJsonFence(trimmed)) as {
      analysis?: unknown
      suggestedReply?: unknown
    }
    const analysis = typeof o.analysis === 'string' ? o.analysis.trim() : ''
    const suggestedReply =
      typeof o.suggestedReply === 'string' && o.suggestedReply.trim() ? o.suggestedReply.trim() : null
    if (analysis) {
      return { analysis, suggestedReply }
    }
  } catch {
    /* fall through */
  }
  return { analysis: trimmed, suggestedReply: null }
}

/**
 * Optional OpenRouter pass over desktop-ingested chat context (summary / pasted transcript).
 * Requires OPENROUTER_API_KEY. Use from API with body `openRouterAnalysis: true` so costs are explicit.
 * Returns structured analysis plus one suggested reply styled like the user's own messages (WeChat/WhatsApp paste).
 */
export async function openRouterDesktopContextAnalysis(
  input: OpenRouterDesktopContextInput,
): Promise<OpenRouterDesktopContextResult | null> {
  const key = process.env.OPENROUTER_API_KEY?.trim()
  if (!key) {
    return null
  }

  const model =
    process.env.OPENROUTER_MODEL?.trim() ||
    'openai/gpt-4o-mini'

  const wm = [input.windowTitle, ...(input.windowClass ?? []).filter(Boolean)].filter(Boolean).join(' · ') || '(unknown)'

  const mime = (input.screenshotMimeType || '').trim().toLowerCase()
  const hasVisionImage =
    Boolean(input.screenshotImageBase64?.length) && /^image\/(png|jpeg|jpg|webp|gif)$/i.test(mime)

  const visionModel =
    process.env.OPENROUTER_VISION_MODEL?.trim() ||
    process.env.OPENROUTER_MODEL?.trim() ||
    'openai/gpt-4o-mini'
  const modelForRequest = hasVisionImage ? visionModel : model

  const userBlock = [
    `Channel: ${input.channel}`,
    `ThreadId: ${input.threadId}`,
    input.contactId ? `ContactId: ${input.contactId}` : '',
    `Active window hint: ${wm}`,
    '',
    `Summary (human):`,
    input.summary ? truncate(input.summary, 4000) : '(none)',
    '',
    `Extracted / pasted transcript:`,
    input.extractedText ? truncate(input.extractedText, 12000) : '(none)',
    '',
    `User-supplied identity hints (merge separately; do not repeat verbatim unless relevant):`,
    input.identityHints.length ? input.identityHints.map(h => `- ${h}`).join('\n') : '(none)',
    '',
    `User-supplied relationship notes:`,
    input.relationshipNotes.length ? input.relationshipNotes.map(n => `- ${n}`).join('\n') : '(none)',
  ]
    .filter(Boolean)
    .join('\n')

  const textCap = hasVisionImage ? 12_000 : 20_000
  const userText = truncate(userBlock, textCap)

  const visionSystemExtra = hasVisionImage
    ? ' A screenshot image is attached: transcribe visible chat text, read UI cues (bubbles, names, timestamps, app chrome), and combine with the structured fields. Do not claim to see content that is illegible or cropped out.'
    : ' The text may be a human summary and/or pasted transcript from WhatsApp, WeChat, or similar (no separate image).'

  type VisionContentPart =
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } }

  const userContent: string | VisionContentPart[] = hasVisionImage
    ? [
        { type: 'text', text: userText },
        {
          type: 'image_url',
          image_url: {
            url: `data:${mime};base64,${input.screenshotImageBase64}`,
            detail: 'auto',
          },
        },
      ]
    : userText

  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(process.env.OPENROUTER_HTTP_REFERER
        ? { 'HTTP-Referer': process.env.OPENROUTER_HTTP_REFERER }
        : {}),
      'X-Title': 'MiraChat desktop context analysis',
    },
    body: JSON.stringify({
      model: modelForRequest,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You analyze desktop-captured chat context for a bounded personal communication delegate.' +
            visionSystemExtra +
            ' Respond with a single JSON object only (no markdown fences) with exactly two keys: ' +
            '"analysis" (string) and "suggestedReply" (string). ' +
            'For "analysis": 6–12 short bullet lines — topic, parties/roles, tone, friction, explicit asks or commitments, ambiguities, relationship signals, what to clarify next. ' +
            'Do not invent facts not supported by the provided text or image. ' +
            'For "suggestedReply": ONE message the human can paste into WeChat or WhatsApp as their reply. ' +
            'Match the human user\'s own tone, formality, language, punctuation, and emoji/sticker habits as inferred from messages that are clearly theirs in the transcript or image. ' +
            'If you cannot tell which side is the user, use a neutral-warm tone appropriate for this channel. ' +
            'Keep it concise; no quotes or labels around the message.',
        },
        {
          role: 'user',
          content: userContent,
        },
      ],
      max_tokens: 1200,
      temperature: 0.25,
    }),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    console.error('OpenRouter desktop context analysis failed', res.status, errText)
    return null
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  const text = data.choices?.[0]?.message?.content?.trim()
  if (!text) {
    return null
  }
  return parseOpenRouterDesktopContextJson(text)
}
