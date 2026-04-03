import type { ContextBundle } from '@delegate-ai/adapter-types'
import { inferImageMimeFromBase64, isOpenRouterVisionImageMime } from './image-mime-sniff.js'
import { isLowSignalInboundText, isReferentialFollowUpText } from './message-signals.js'
import {
  buildDataUrlForOpenRouterVision,
  buildOpenRouterMultimodalUserContent,
  isOpenRouterVisionModelAllowed,
  parseOpenRouterChatCompletionContent,
  validateOpenRouterImageUrl,
  validateVisionBase64PayloadLength,
  type OpenRouterMultimodalUserContentPart,
} from './openrouter-vision-schema.js'
import {
  buildAnalysisAssistSystemPrompt,
  buildDesktopContextSystemPrompt,
  buildPrimaryReplySystemPrompt,
} from './openrouter-prompt-os.js'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const OPENROUTER_TIMEOUT_MS_DEFAULT = 15_000

/** First line of a `memory_chunks` row: paste-ready reply from vision+text ingest (primary draft reads this). */
export const MIRACHAT_INGEST_SUGGESTED_REPLY_MARKER = '[mirachat:ingest_suggested_reply]'

export function buildIngestSuggestedReplyMemoryChunk(input: {
  channel: string
  threadId: string
  reply: string
}): string {
  const r = input.reply.trim()
  if (!r) {
    return ''
  }
  return `${MIRACHAT_INGEST_SUGGESTED_REPLY_MARKER}\nchannel=${input.channel}\nthread=${input.threadId}\n\n${r}`
}

/** Latest matching memory row body (after headers), for grounding outbound drafts. */
export function extractLatestIngestSuggestedReply(
  recent: { channel: string; content: string }[],
): string | null {
  const marker = MIRACHAT_INGEST_SUGGESTED_REPLY_MARKER
  const hits = recent.filter(m => m.channel === 'memory' && m.content.trim().startsWith(marker))
  if (hits.length === 0) {
    return null
  }
  const last = hits[hits.length - 1]!
  const body = last.content.split('\n\n').slice(1).join('\n\n').trim()
  return body || null
}

const truncate = (s: string, max: number): string => {
  if (s.length <= max) {
    return s
  }
  return `${s.slice(0, max)}\n…`
}

const openRouterTimeoutMs = (): number => {
  const raw = Number(process.env.OPENROUTER_TIMEOUT_MS ?? process.env.OPENROUTER_PRD_TIMEOUT_MS ?? OPENROUTER_TIMEOUT_MS_DEFAULT)
  return Number.isFinite(raw) && raw >= 100 ? raw : OPENROUTER_TIMEOUT_MS_DEFAULT
}

async function openRouterFetch(
  title: string,
  body: Record<string, unknown>,
  headers: Record<string, string>,
): Promise<Response | null> {
  const controller = new AbortController()
  const timeoutMs = openRouterTimeoutMs()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const prefix = message.toLowerCase().includes('abort') ? 'timed out' : 'failed'
    console.warn(`OpenRouter ${title} ${prefix}; using fallback`, { timeoutMs, message })
    return null
  } finally {
    clearTimeout(timer)
  }
}

const formatMessages = (label: string, messages: { threadId: string; direction: string; content: string }[]): string => {
  if (messages.length === 0) {
    return `${label}: (none)`
  }
  return `${label}:\n${messages
    .map(m => `[${m.direction} ${m.threadId.slice(0, 12)}…] ${m.content}`)
    .join('\n')}`
}

const formatImportedMemoryBlock = (
  recent: { channel: string; threadId: string; direction: string; content: string }[],
): string => {
  const rows = recent
    .filter(m => m.channel === 'memory')
    .map(m => m.content.trim())
    .filter(Boolean)
    .filter(c => !c.startsWith(MIRACHAT_INGEST_SUGGESTED_REPLY_MARKER))
  if (rows.length === 0) {
    return ''
  }
  return `Imported thread memory (desktop/ingest; same conversation):\n${rows.join('\n---\n')}`
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

  const headers = {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...(process.env.OPENROUTER_HTTP_REFERER
      ? { 'HTTP-Referer': process.env.OPENROUTER_HTTP_REFERER }
      : {}),
    'X-Title': 'MiraChat analysis assist',
  }
  const res = await openRouterFetch('analysis assist', {
      model,
      messages: [
        {
          role: 'system',
          content: buildAnalysisAssistSystemPrompt(),
        },
        {
          role: 'user',
          content: `Latest message from them:\n${truncate(input.latestUserText, 8000)}\n\n${threadExcerpt}\n\n${searchExcerpt}`,
        },
      ],
      max_tokens: 500,
      temperature: 0.2,
    }, headers)

  if (!res) {
    return null
  }

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

export interface OpenRouterMemoryAttentionInput {
  latestUserText: string
  recentMessages: { threadId: string; direction: string; content: string }[]
  structuredRecall: { internalSummary: string; entityBullets: string; eventBullets: string }
}

/**
 * Attention-based retrieval: filters the full structured memory ledger against the current context
 * to extract only strictly relevant facts and commitments.
 */
export async function openRouterMemoryAttention(input: OpenRouterMemoryAttentionInput): Promise<string | null> {
  const key = process.env.OPENROUTER_API_KEY?.trim()
  if (!key) {
    return null
  }

  const model =
    process.env.OPENROUTER_MEMORY_MODEL?.trim() ||
    process.env.OPENROUTER_MODEL?.trim() ||
    'openai/gpt-4o-mini'

  const threadExcerpt = truncate(
    formatMessages('Current thread', input.recentMessages),
    8000,
  )

  const ledgerText = `
--- NARRATIVE ---
${input.structuredRecall.internalSummary}

--- ENTITIES ---
${input.structuredRecall.entityBullets}

--- EVENTS ---
${input.structuredRecall.eventBullets}
`.trim()

  const systemPrompt = `You are an attention filter for a communication proxy.
Your job is to read the user's full memory ledger (entities, events, narrative) and extract ONLY the facts that are strictly relevant to the current thread and the latest inbound message.
Do not write a reply. Output a concise bulleted list of relevant facts. If nothing in the ledger is relevant, output "No relevant ledger facts."`

  const userPrompt = `Latest inbound message:
${truncate(input.latestUserText, 4000)}

${threadExcerpt}

Full Memory Ledger:
${truncate(ledgerText, 16000)}`

  const headers = {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...(process.env.OPENROUTER_HTTP_REFERER
      ? { 'HTTP-Referer': process.env.OPENROUTER_HTTP_REFERER }
      : {}),
    'X-Title': 'MiraChat memory attention',
  }
  const res = await openRouterFetch('memory attention', {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 400,
      temperature: 0.1,
    }, headers)

  if (!res) {
    return null
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    console.error('OpenRouter memory attention failed', res.status, errText)
    return null
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  const text = data.choices?.[0]?.message?.content?.trim()
  if (text === 'No relevant ledger facts.') {
    return null
  }
  return text || null
}

export interface OpenRouterPolicyEvaluationInput {
  draft: string
  attendedRecall: string
  hardBoundaries: string[]
}

export async function openRouterPolicyEvaluation(input: OpenRouterPolicyEvaluationInput): Promise<{ safe: boolean; reason?: string }> {
  const key = process.env.OPENROUTER_API_KEY?.trim()
  if (!key || !input.attendedRecall) {
    return { safe: true }
  }

  const model =
    process.env.OPENROUTER_MEMORY_MODEL?.trim() ||
    process.env.OPENROUTER_MODEL?.trim() ||
    'openai/gpt-4o-mini'

  const systemPrompt = `You are a strict Policy Engine for an AI communication proxy.
Evaluate the proposed draft against the user's Hard Boundaries and the Attended Ledger facts.
If the draft violates ANY boundary or contradicts ANY ledger fact, output "BLOCK: <reason>".
Otherwise, output "SAFE".`

  const userPrompt = `Hard Boundaries:
${input.hardBoundaries.join(', ') || 'None'}

Attended Ledger Facts:
${input.attendedRecall}

Proposed Draft:
${input.draft}`

  const headers = {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...(process.env.OPENROUTER_HTTP_REFERER
      ? { 'HTTP-Referer': process.env.OPENROUTER_HTTP_REFERER }
      : {}),
    'X-Title': 'MiraChat policy evaluation',
  }
  const res = await openRouterFetch('policy evaluation', {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 100,
      temperature: 0.0,
    }, headers)

  if (!res) {
    return { safe: true }
  }

  if (!res.ok) {
    return { safe: true }
  }

  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  const text = data.choices?.[0]?.message?.content?.trim() || 'SAFE'
  
  if (text.startsWith('BLOCK:')) {
    return { safe: false, reason: text.replace('BLOCK:', '').trim() }
  }
  return { safe: true }
}

const primaryDraftDisabled = (): boolean => {
  const v = process.env.OPENROUTER_PRIMARY_DRAFT?.trim().toLowerCase()
  return v === '0' || v === 'false' || v === 'off'
}

/** True when OPENROUTER_API_KEY is set and primary draft is not disabled via OPENROUTER_PRIMARY_DRAFT. */
export function isOpenRouterPrimaryDraftEnabled(): boolean {
  const key = process.env.OPENROUTER_API_KEY?.trim()
  if (!key) {
    return false
  }
  return !primaryDraftDisabled()
}

const stripLightMarkdown = (s: string): string =>
  s
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^#+\s+/gm, '')
    .trim()

/**
 * Draft the outbound reply body for general-domain messages via OpenRouter when
 * OPENROUTER_API_KEY is set. Template fallback lives in cognitive.ts when this returns null.
 */
export async function openRouterPrimaryReplyDraft(
  context: ContextBundle,
  planInstruction: string,
): Promise<string | null> {
  const key = process.env.OPENROUTER_API_KEY?.trim()
  if (!key || primaryDraftDisabled()) {
    return null
  }

  const model =
    process.env.OPENROUTER_MODEL?.trim() ||
    'openai/gpt-4o-mini'

  const boundaries =
    context.identity.hardBoundaries.length > 0
      ? context.identity.hardBoundaries.join('; ')
      : '(none specified)'
  const ingestPasteReply = extractLatestIngestSuggestedReply(context.memory.recentMessages)
  const ingestReplyLead = ingestPasteReply
    ? `${truncate(
        `Paste-ready reply from your latest screenshot+text ingest (OpenRouter saw the image + fields below; adapt wording to their latest message and your identity; keep factual claims grounded in that ingest):\n${ingestPasteReply}`,
        5000,
      )}\n\n`
    : ''
  const importedMemory = truncate(formatImportedMemoryBlock(context.memory.recentMessages), 6000)
  const transcriptOnly = context.memory.recentMessages.filter(m => m.channel !== 'memory')
  const threadExcerpt = truncate(formatMessages('Current thread (messages only)', transcriptOnly), 12000)
  const searchExcerpt = truncate(
    formatMessages('Search hits (other threads / history)', context.memory.searchMatches),
    8000,
  )
  const thinInbound = isLowSignalInboundText(context.event.text)
  const referentialFollowUp = isReferentialFollowUpText(context.event.text)
  const memoryLead = importedMemory.length > 0 ? `${importedMemory}\n\n` : ''
  const continuityHint = referentialFollowUp
    ? 'Their latest line is referential and ambiguous (for example: "how about this"). Do not answer an older screenshot, attachment, or earlier question as if it were the new item. If the latest message does not itself contain the new content to evaluate, reply with one brief clarifying question asking them to send or restate what they want reviewed.\n\n'
    : thinInbound
      ? 'Their latest line is short or ambiguous: treat it as a follow-up in this same conversation (imported memory + prior messages), not as a brand-new unrelated topic unless the thread clearly supports that.\n\n'
      : ''

  const headers = {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...(process.env.OPENROUTER_HTTP_REFERER
      ? { 'HTTP-Referer': process.env.OPENROUTER_HTTP_REFERER }
      : {}),
    'X-Title': 'MiraChat primary reply draft',
  }
  const res = await openRouterFetch('primary reply draft', {
      model,
      messages: [
        {
          role: 'system',
          content: buildPrimaryReplySystemPrompt({
            boundaries,
            tone: context.relationship.tone,
            role: context.relationship.role,
            riskLevel: context.relationship.riskLevel,
            displayName: context.identity.displayName || 'the sender',
          }),
        },
        {
          role: 'user',
          content: `Context for drafting (analysis + instructions, not verbatim):\n${truncate(planInstruction, 6000)}\n\nSpeaker roles:\n- You / the sender: ${context.identity.displayName || 'the user'}\n- Them / the contact: ${context.relationship.contactId || context.event.senderId}\n\n${ingestReplyLead}${memoryLead}${continuityHint}Latest message from them:\n${truncate(context.event.text, 4000)}\n\n${threadExcerpt}\n\n${searchExcerpt}\n\nWrite exactly one reply message from the sender's perspective ("I"). Aim under 120 words.`,
        },
      ],
      max_tokens: 500,
      temperature: 0.35,
    }, headers)

  if (!res) {
    return null
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    console.error('OpenRouter primary reply draft failed', res.status, errText)
    return null
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  const raw = data.choices?.[0]?.message?.content?.trim()
  if (!raw) {
    return null
  }
  const cleaned = stripLightMarkdown(raw).replace(/\s+/g, ' ').trim()
  if (!cleaned || cleaned.length < 8) {
    return null
  }
  return truncate(cleaned, 1200)
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
  /**
   * Public HTTPS image URL (OpenRouter `image_url.url`). Preferred over base64 when both are set.
   * Must pass {@link validateOpenRouterImageUrl} (see OPENROUTER_ALLOW_HTTP_IMAGE_URL for localhost).
   */
  screenshotImageUrl?: string
}

/** Parsed model output for desktop ingest (analysis bullets + one paste-ready reply). */
export interface OpenRouterDesktopContextResult {
  /** Plain description of visible screenshot content (empty when no image or model omitted). */
  whatISee: string
  /** Interpretation bullets; when `whatISee` is set, storage/API prepend a "What I see:" block to this for continuity. */
  analysis: string
  suggestedReply: string | null
  /** Vision only: model believes the screenshot shows a clear counterparty profile avatar. */
  contactAvatarIdentified: boolean
  /** Optional internal ordering notes — omit from user-visible surfaces unless explicitly enabled (see MIRACHAT_EXPOSE_OPENROUTER_REASONING). */
  reasoningTrace?: string
  /** True when a screenshot was included as an image_url part in the OpenRouter request. */
  visionAttached?: boolean
  extractedMessages?: { sender: 'them' | 'me'; text: string }[]
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

const tryParseObject = (s: string): Record<string, unknown> | null => {
  const t = s.trim()
  for (const candidate of [t, stripJsonFence(t)]) {
    if (!candidate) {
      continue
    }
    try {
      const o = JSON.parse(candidate) as unknown
      if (o && typeof o === 'object' && !Array.isArray(o)) {
        return o as Record<string, unknown>
      }
    } catch {
      /* try next */
    }
  }
  const idx = t.indexOf('{')
  if (idx === -1) {
    return null
  }
  let depth = 0
  for (let i = idx; i < t.length; i++) {
    const ch = t[i]
    if (ch === '{') {
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0) {
        const slice = t.slice(idx, i + 1)
        try {
          const o = JSON.parse(slice) as unknown
          if (o && typeof o === 'object' && !Array.isArray(o)) {
            return o as Record<string, unknown>
          }
        } catch {
          return null
        }
      }
    }
  }
  return null
}

const normalizeAnalysis = (raw: unknown): string => {
  if (typeof raw === 'string') {
    return raw.trim()
  }
  if (Array.isArray(raw)) {
    return raw
      .map(x => String(x))
      .join('\n')
      .trim()
  }
  return ''
}

const normalizeWhatISee = (raw: unknown): string => {
  if (typeof raw === 'string') {
    return raw.trim()
  }
  if (Array.isArray(raw)) {
    return raw
      .map(x => String(x))
      .join('\n')
      .trim()
  }
  return ''
}

const normalizeReasoningTrace = (raw: unknown): string => {
  if (typeof raw === 'string') {
    return raw.trim()
  }
  return ''
}

const mergeWhatISeeIntoAnalysis = (whatISee: string, analysisBody: string): string => {
  const w = whatISee.trim()
  const a = analysisBody.trim()
  if (!w) {
    return a
  }
  if (!a) {
    return `What I see:\n${w}`
  }
  return `What I see:\n${w}\n\n${a}`
}

const parseContactAvatarIdentified = (o: Record<string, unknown>): boolean => {
  const cav = o.contactAvatarIdentified ?? o.contact_avatar_identified
  if (cav === true) {
    return true
  }
  if (cav === false) {
    return false
  }
  if (typeof cav === 'string') {
    const s = cav.trim().toLowerCase()
    return s === 'true' || s === 'yes' || s === '1'
  }
  return false
}

/**
 * Parse JSON object from model; on failure treat entire string as analysis only.
 * Exported for tests.
 */
export function parseOpenRouterDesktopContextJson(raw: string): OpenRouterDesktopContextResult {
  const trimmed = raw.trim()
  if (!trimmed) {
    return { whatISee: '', analysis: '', suggestedReply: null, contactAvatarIdentified: false }
  }
  const o = tryParseObject(trimmed)
  if (o) {
    const whatISee = normalizeWhatISee(
      o.whatISee ?? o.what_i_see ?? o.visualDescription ?? o.visual_description ?? o.seeFirst,
    )
    const analysisBody = normalizeAnalysis(o.analysis ?? o.bullets ?? o.notes)
    const analysis = mergeWhatISeeIntoAnalysis(whatISee, analysisBody)
    const srRaw = o.suggestedReply ?? o.suggested_reply ?? o.reply ?? o.message ?? o.pasteReply
    const suggestedReply = typeof srRaw === 'string' && srRaw.trim() ? srRaw.trim() : null
    const contactAvatarIdentified = parseContactAvatarIdentified(o)
    const reasoningRaw = normalizeReasoningTrace(o.reasoningTrace ?? o.reasoning_trace)
    const reasoningTrace = reasoningRaw || undefined
    const extractedMessages = Array.isArray(o.extractedMessages) ? o.extractedMessages as any : undefined
    if (analysis || suggestedReply || extractedMessages) {
      return { whatISee, analysis, suggestedReply, contactAvatarIdentified, reasoningTrace, extractedMessages }
    }
    return { whatISee, analysis: '', suggestedReply: null, contactAvatarIdentified, reasoningTrace, extractedMessages }
  }
  return { whatISee: '', analysis: trimmed, suggestedReply: null, contactAvatarIdentified: false }
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

  let publicImageUrl: string | undefined
  if (input.screenshotImageUrl?.trim()) {
    const v = validateOpenRouterImageUrl(input.screenshotImageUrl)
    if (!v.ok) {
      console.error('OpenRouter desktop context: invalid screenshotImageUrl', v.error)
      return null
    }
    publicImageUrl = v.url
  }

  let mime = (input.screenshotMimeType || '').trim().toLowerCase()
  const preferUrl = Boolean(publicImageUrl)
  let base64Vision =
    Boolean(input.screenshotImageBase64?.length) && !preferUrl && isOpenRouterVisionImageMime(mime)
  if (Boolean(input.screenshotImageBase64?.length) && !preferUrl && !base64Vision) {
    const inferred = inferImageMimeFromBase64(input.screenshotImageBase64!)
    if (inferred) {
      mime = inferred
      base64Vision = isOpenRouterVisionImageMime(mime)
    }
  }

  if (base64Vision) {
    const sz = validateVisionBase64PayloadLength(input.screenshotImageBase64!.length)
    if (!sz.ok) {
      console.error('OpenRouter desktop context:', sz.error)
      return null
    }
  }

  const hasVisionImage = Boolean(publicImageUrl) || base64Vision

  const visionModel =
    process.env.OPENROUTER_VISION_MODEL?.trim() ||
    process.env.OPENROUTER_MODEL?.trim() ||
    'openai/gpt-4o-mini'
  const modelForRequest = hasVisionImage ? visionModel : model

  if (hasVisionImage && !isOpenRouterVisionModelAllowed(modelForRequest)) {
    console.error(
      'OpenRouter desktop context: model may not support vision image_url parts; set OPENROUTER_VISION_MODEL to a multimodal id (e.g. openai/gpt-4o-mini) or OPENROUTER_VISION_MODEL_ALLOWLIST',
      modelForRequest,
    )
    return null
  }

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

  const dataUrlForVision =
    base64Vision && input.screenshotImageBase64
      ? buildDataUrlForOpenRouterVision(mime, input.screenshotImageBase64)
      : undefined

  const userContent: string | OpenRouterMultimodalUserContentPart[] = hasVisionImage
    ? buildOpenRouterMultimodalUserContent({
        text: userText,
        imageUrl: publicImageUrl,
        dataUrl: publicImageUrl ? undefined : dataUrlForVision,
      })
    : userText

  const headers = {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...(process.env.OPENROUTER_HTTP_REFERER
      ? { 'HTTP-Referer': process.env.OPENROUTER_HTTP_REFERER }
      : {}),
    'X-Title': 'MiraChat desktop context analysis',
  }

  const messages = [
    {
      role: 'system' as const,
      content: buildDesktopContextSystemPrompt(hasVisionImage),
    },
    {
      role: 'user' as const,
      content: userContent,
    },
  ]

  const basePayload = {
    model: modelForRequest,
    messages,
    max_tokens: 1200,
    temperature: 0.25,
  }

  let res = await openRouterFetch('desktop context analysis', {
    ...basePayload,
    response_format: { type: 'json_object' },
  }, headers)

  if (!res) {
    return null
  }

  if (!res.ok && (res.status === 400 || res.status === 422)) {
    const errPeek = await res.text().catch(() => '')
    console.warn(
      'OpenRouter desktop: response_format json_object rejected; retrying without it',
      res.status,
      errPeek.slice(0, 400),
    )
    res = await openRouterFetch('desktop context analysis retry', basePayload, headers)
    if (!res) {
      return null
    }
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    console.error('OpenRouter desktop context analysis failed', res.status, errText)
    return null
  }

  const data: unknown = await res.json().catch(() => null)
  const text = data ? parseOpenRouterChatCompletionContent(data) : null
  if (!text) {
    console.error('OpenRouter desktop context: missing or invalid choices[0].message.content')
    return null
  }
  if (process.env.OPENROUTER_LOG_RAW_CONTENT === '1') {
    console.error('[OpenRouter raw choices[0].message.content]\n', text)
  }
  return { ...parseOpenRouterDesktopContextJson(text), visionAttached: hasVisionImage }
}
