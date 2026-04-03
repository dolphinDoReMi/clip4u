import type { ContextBundle, DelegateDraft } from '@delegate-ai/adapter-types'
import { AssistService } from '@delegate-ai/assist-core'

import { buildPrdReplyOptionsSystemPrompt, buildThreadSummarySystemPrompt } from './openrouter-prompt-os.js'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

export type PrdReplyOption = { label: string; text: string }

const truncate = (s: string, max: number): string => (s.length <= max ? s : `${s.slice(0, max)}…`)

const contextExcerpt = (context: ContextBundle): string => {
  const thread = context.memory.recentMessages
    .map(m => `${m.direction}: ${m.content}`)
    .join('\n')
  const hits = context.memory.searchMatches
    .slice(0, 12)
    .map(m => `[${m.threadId}] ${m.content}`)
    .join('\n')
  return truncate(
    `User: ${context.identity.displayName}\nTone: ${context.relationship.tone} risk=${context.relationship.riskLevel}\nLatest: ${context.event.text}\n\nThread:\n${thread}\n\nSearch hits:\n${hits}`,
    14000,
  )
}

/** Short “direct” variant: never identical to full draft when avoidable (fixes Main suggestion === Direct in UI). */
export const shorterDirectFromPrimary = (full: string): string => {
  const t = full.trim()
  if (!t) {
    return ''
  }
  const sentenceSplit = t.split(/(?<=[.!?？。！])\s+/)
  const firstSentence = sentenceSplit[0]?.trim() ?? ''
  if (firstSentence.length >= 24 && firstSentence.length + 24 < t.length) {
    return firstSentence
  }
  const firstPara = t.split(/\n\n|\r\n\r\n/)[0]?.trim() ?? ''
  if (firstPara.length >= 28 && firstPara.length + 24 < t.length) {
    return firstPara
  }
  const words = t.split(/\s+/)
  if (words.length > 22) {
    return `${words.slice(0, 20).join(' ')}…`
  }
  const target = Math.min(160, Math.max(48, Math.floor(t.length * 0.38)))
  if (target + 35 < t.length) {
    let slice = t.slice(0, target)
    const sp = slice.lastIndexOf(' ')
    if (sp > 28) {
      slice = slice.slice(0, sp)
    }
    return `${slice.trim()}…`
  }
  return t.length > 72 ? `${t.slice(0, 68).trim()}…` : t
}

export const fallbackReplyOptions = (primaryDraft: string): PrdReplyOption[] => {
  const t = primaryDraft.trim()
  const empty = '(empty draft — refine in console)'
  if (!t) {
    return [
      { label: 'direct', text: empty },
      { label: 'balanced', text: empty },
      { label: 'relationship-first', text: empty },
    ]
  }
  const balanced = t
  let direct = shorterDirectFromPrimary(t)
  if (direct.trim().toLowerCase() === balanced.trim().toLowerCase()) {
    const w = t.split(/\s+/)
    direct = w.length > 14 ? `${w.slice(0, 12).join(' ')}…` : `${t.slice(0, Math.min(56, t.length)).trim()}…`
  }
  if (direct.trim().toLowerCase() === balanced.trim().toLowerCase()) {
    direct = `Got it — ${balanced.slice(0, 1).toLowerCase()}${balanced.slice(1, Math.min(200, balanced.length)).trim()}${balanced.length > 200 ? '…' : ''}`
  }
  const relationshipFirst = `${balanced}${/[.!?？。！]\s*$/.test(balanced) ? '' : '.'}\n\nThanks for your patience — happy to adjust if anything shifts on your side.`
  return sortOptionsMvpOrder([
    { label: 'direct', text: direct.trim() || balanced },
    { label: 'balanced', text: balanced },
    { label: 'relationship-first', text: relationshipFirst },
  ])
}

const replyOptionsDistinctEnough = (opts: PrdReplyOption[]): boolean => {
  const texts = opts.map(o => o.text.replace(/\s+/g, ' ').trim().toLowerCase())
  if (texts.length < 3) {
    return false
  }
  return new Set(texts).size === 3
}

const normalizeReplyOptionLabel = (label: string): string => {
  const k = label.trim().toLowerCase()
  if (k === 'concise' || k === 'assertive') return 'direct'
  if (k === 'warm') return 'relationship-first'
  return k
}

const ORDERED_MVP_LABELS = ['direct', 'balanced', 'relationship-first'] as const

const sortOptionsMvpOrder = (opts: PrdReplyOption[]): PrdReplyOption[] => {
  const rank = (l: string) => {
    const i = ORDERED_MVP_LABELS.indexOf(l as (typeof ORDERED_MVP_LABELS)[number])
    return i >= 0 ? i : 99
  }
  return [...opts].sort((a, b) => rank(a.label) - rank(b.label))
}

export const fallbackThreadSummary = (transcript: string): string => {
  const t = transcript.trim()
  if (!t) {
    return 'No prior messages in this thread.'
  }
  return truncate(t.replace(/\s+/g, ' '), 1200)
}

/** Build transcript lines for summarization — use chat-app labels so models (and fallbacks) avoid inbound/outbound jargon. */
export function linesForSummaryTranscript(messages: { direction: string; content: string }[]): string {
  return messages
    .map((m) => {
      const d = String(m.direction || '').toLowerCase()
      if (d === 'inbound') return `Them: ${m.content}`
      if (d === 'outbound') return `You: ${m.content}`
      if (d === 'memory') return `Saved note: ${m.content}`
      return `${m.direction}: ${m.content}`
    })
    .join('\n')
}

function parseJsonObjectLoose<T extends Record<string, unknown>>(raw: string): T | null {
  const trimmed = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
  try {
    const o = JSON.parse(trimmed) as unknown
    if (o && typeof o === 'object' && !Array.isArray(o)) {
      return o as T
    }
  } catch {
    /* try brace slice */
  }
  const idx = trimmed.indexOf('{')
  if (idx === -1) {
    return null
  }
  let depth = 0
  for (let i = idx; i < trimmed.length; i++) {
    const ch = trimmed[i]
    if (ch === '{') {
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0) {
        try {
          const o = JSON.parse(trimmed.slice(idx, i + 1)) as unknown
          if (o && typeof o === 'object' && !Array.isArray(o)) {
            return o as T
          }
        } catch {
          return null
        }
      }
    }
  }
  return null
}

async function openRouterJson<T extends Record<string, unknown>>(body: Record<string, unknown>): Promise<T | null> {
  const key = process.env.OPENROUTER_API_KEY?.trim()
  if (!key) {
    return null
  }
  const headers = {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...(process.env.OPENROUTER_HTTP_REFERER ? { 'HTTP-Referer': process.env.OPENROUTER_HTTP_REFERER } : {}),
    'X-Title': 'MiraChat PRD delegate',
  }
  const withFormat = { ...body, response_format: { type: 'json_object' as const } }
  let res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(withFormat),
  })
  if (!res.ok && (res.status === 400 || res.status === 422)) {
    const errPeek = await res.text().catch(() => '')
    console.warn(
      'OpenRouter PRD: response_format json_object rejected; retrying without it',
      res.status,
      errPeek.slice(0, 240),
    )
    res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
  }
  if (!res.ok) {
    console.error('OpenRouter PRD call failed', res.status, await res.text().catch(() => ''))
    return null
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  const raw = data.choices?.[0]?.message?.content?.trim()
  if (!raw) {
    return null
  }
  return parseJsonObjectLoose<T>(raw)
}

/** MVP: three ready-to-send replies — direct, balanced, relationship-first (OpenRouter JSON or templates). */
export async function buildReplyOptions(
  context: ContextBundle,
  primaryDraftText: string,
): Promise<PrdReplyOption[]> {
  const parsed = await openRouterJson<{ options: PrdReplyOption[] }>({
    model: process.env.OPENROUTER_MODEL?.trim() || 'openai/gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: buildPrdReplyOptionsSystemPrompt(),
      },
      {
        role: 'user',
        content: `${contextExcerpt(context)}\n\nMain suggested reply to vary:\n${truncate(primaryDraftText, 6000)}`,
      },
    ],
    max_tokens: 900,
    temperature: 0.35,
  })
  const raw = parsed?.options?.filter(o => o?.label && o?.text && String(o.text).trim())
  if (raw && raw.length >= 3) {
    const normalized = sortOptionsMvpOrder(
      raw.slice(0, 3).map(o => ({
        label: normalizeReplyOptionLabel(String(o.label)),
        text: String(o.text).trim(),
      })),
    )
    if (replyOptionsDistinctEnough(normalized)) {
      return normalized
    }
  }
  return fallbackReplyOptions(primaryDraftText)
}

async function openRouterPlainText(system: string, userContent: string): Promise<string | null> {
  const key = process.env.OPENROUTER_API_KEY?.trim()
  if (!key) {
    return null
  }
  const model = process.env.OPENROUTER_MODEL?.trim() || 'openai/gpt-4o-mini'
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(process.env.OPENROUTER_HTTP_REFERER
        ? { 'HTTP-Referer': process.env.OPENROUTER_HTTP_REFERER }
        : {}),
      'X-Title': 'MiraChat thread summary',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userContent },
      ],
      max_tokens: 500,
      temperature: 0.2,
    }),
  })
  if (!res.ok) {
    console.error('OpenRouter summary failed', res.status, await res.text().catch(() => ''))
    return null
  }
  const j = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  return j.choices?.[0]?.message?.content?.trim() ?? null
}

/** Thread snapshot for triage: bullets + scannable context (control plane / web). */
export async function buildThreadSummary(transcript: string): Promise<string> {
  const text = await openRouterPlainText(
    buildThreadSummarySystemPrompt(),
    truncate(transcript, 12000),
  )
  return text || fallbackThreadSummary(transcript)
}

/** PRD assist path: legacy AssistService stubs plus context-aware prompt. */
export async function buildAssistSuggestions(context: ContextBundle): Promise<DelegateDraft[]> {
  const assist = new AssistService()
  const prompt = [
    `Latest: ${context.event.text}`,
    `Relationship tone: ${context.relationship.tone} (${context.relationship.riskLevel})`,
    context.memory.recentMessages.length
      ? `Thread excerpt:\n${linesForSummaryTranscript(context.memory.recentMessages.slice(-6))}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n')
  return assist.suggestReplies({
    request: { userId: context.event.userId, prompt },
    identity: context.identity,
    relationship: context.relationship,
  })
}
