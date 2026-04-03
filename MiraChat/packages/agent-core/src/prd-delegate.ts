import type { ContextBundle, DelegateDraft } from '@delegate-ai/adapter-types'
import { AssistService } from '@delegate-ai/assist-core'

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

export const fallbackReplyOptions = (primaryDraft: string): PrdReplyOption[] => {
  const t = primaryDraft.trim()
  const empty = '(empty draft — refine in console)'
  const firstSentence = t ? t.split(/(?<=[.!?])\s+/)[0]?.trim() : ''
  const useTight =
    firstSentence &&
    firstSentence.length >= 12 &&
    firstSentence.length + 8 < t.length
  const direct = t
    ? useTight
      ? firstSentence
      : t.length > 220
        ? `${t.slice(0, 200).trim()}…`
        : t
    : empty
  const balanced = t || empty
  const relationshipFirst = t
    ? `${balanced}\n\nThanks again — happy to adjust if anything changes on your side.`
    : empty
  return [
    { label: 'direct', text: direct },
    { label: 'balanced', text: balanced },
    { label: 'relationship-first', text: relationshipFirst },
  ]
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

async function openRouterJson<T>(body: Record<string, unknown>): Promise<T | null> {
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
      'X-Title': 'MiraChat PRD delegate',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    console.error('OpenRouter PRD call failed', res.status, await res.text().catch(() => ''))
    return null
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  const raw = data.choices?.[0]?.message?.content?.trim()
  if (!raw) {
    return null
  }
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
    return JSON.parse(cleaned) as T
  } catch {
    return null
  }
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
        content:
          'You output JSON only: {"options":[{"label":"direct","text":"..."},{"label":"balanced","text":"..."},{"label":"relationship-first","text":"..."}]} — three distinct outbound replies the human can send as-is. Same facts and intent; direct = shortest clear next step; balanced = primary tone; relationship-first = warm, acknowledges the relationship, minimal risk of sounding cold or escalatory. No new commitments beyond the primary draft. Labels must be exactly direct, balanced, relationship-first.',
      },
      {
        role: 'user',
        content: `${contextExcerpt(context)}\n\nPrimary draft to vary:\n${truncate(primaryDraftText, 6000)}`,
      },
    ],
    max_tokens: 900,
    temperature: 0.35,
  })
  const raw = parsed?.options?.filter(o => o?.label && o?.text && String(o.text).trim())
  if (raw && raw.length >= 3) {
    const normalized = raw.slice(0, 3).map(o => ({
      label: normalizeReplyOptionLabel(String(o.label)),
      text: String(o.text).trim(),
    }))
    return sortOptionsMvpOrder(normalized)
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
    'Summarize this conversation for someone about to reply. Use 5–10 short bullet points: what was asked, what was promised, open threads, and tone. Neutral and factual. If something looks like an implicit commitment or date, call it out. Plain text only.',
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
      ? `Thread excerpt:\n${context.memory.recentMessages
          .slice(-6)
          .map(m => `${m.direction}: ${m.content}`)
          .join('\n')}`
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
