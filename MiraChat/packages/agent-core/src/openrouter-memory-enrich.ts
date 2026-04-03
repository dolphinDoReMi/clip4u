/**
 * Batched OpenRouter call: entities + sequence events + narrative delta (PRD memory strategy).
 * @see docs/system-design-proxy-self.md §14.7
 */
import { parseOpenRouterChatCompletionContent } from './openrouter-vision-schema.js'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

export const OPENROUTER_MEMORY_ENRICH_VERSION = '2026-04-03'

export interface MemoryEnrichmentEntity {
  surfaceForm: string
  entityType: string
  canonicalLabel: string
  confidence: number | null
  contactId: string | null
  notes: string | null
}

export interface MemoryEnrichmentEvent {
  kind: string
  summary: string
  entitiesTouched: string[]
  orderingHint: string | null
  recurrence: string | null
  dueHint: Date | null
  confidence: number | null
}

export interface MemoryEnrichmentNarrativeDelta {
  narrativeMarkdown: string
  internalSummary: string
  conflicts: unknown | null
  confidence: number | null
}

export interface MemoryEnrichmentOpenRouterInput {
  userId: string
  threadId: string
  inboundMessageId: string
  rawText: string
  knownContactHints: string[]
  priorNarrativeInternal: string
  recentEventSummaries: string[]
}

export interface MemoryEnrichmentParsed {
  entities: MemoryEnrichmentEntity[]
  events: MemoryEnrichmentEvent[]
  narrativeDelta: MemoryEnrichmentNarrativeDelta | null
}

const clampStr = (s: unknown, max: number): string => {
  if (typeof s !== 'string') {
    return ''
  }
  const t = s.trim()
  return t.length > max ? t.slice(0, max) : t
}

const numOrNull = (v: unknown): number | null => {
  if (typeof v !== 'number' || Number.isNaN(v)) {
    return null
  }
  return Math.min(1, Math.max(0, v))
}

const strArr = (v: unknown): string[] => {
  if (!Array.isArray(v)) {
    return []
  }
  return v.filter((x): x is string => typeof x === 'string').map(s => s.trim()).filter(Boolean)
}

const parseDue = (v: unknown): Date | null => {
  if (typeof v !== 'string' || !v.trim()) {
    return null
  }
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

const buildSystemPrompt = (): string =>
  [
    `MiraChat memory enrichment v${OPENROUTER_MEMORY_ENRICH_VERSION}. Output a single JSON object only.`,
    '',
    'Extract from the user message (and hints):',
    '1) entities: people (contacts/public figures as the user references them), orgs, products, places, identifiable items, fictional characters. Use entityType: contact_candidate | public_figure | organization | product | place | identifiable_item | fictional_character | other.',
    '2) events: commitments, follow-ups, recurrence, scheduling constraints, state changes. kind: commitment | follow_up | recurrence | scheduling_constraint | state_change | other.',
    '3) narrativeDelta: short user-facing narrative (narrativeMarkdown, 2–6 bullets as a string) and internalSummary (one dense paragraph for system prompts). If you infer a contradiction with prior narrative, list conflicts: [{ field, before, after, resolution: "needs_user_confirm" | "merge" }].',
    '',
    'Rules: no invented facts; use null or omit when unknown; confidence 0–1 when present; entitiesTouched string array on events; dueHint ISO-8601 when applicable.',
    'JSON shape:',
    '{"entities":[{"surfaceForm","entityType","canonicalLabel","confidence","contactId","notes"}],',
    '"events":[{"kind","summary","entitiesTouched","ordering","recurrence","dueHint","confidence"}],',
    '"narrativeDelta":{"narrativeMarkdown","internalSummary","conflicts","confidence"}}',
  ].join('\n')

export function parseMemoryEnrichmentJson(raw: string): MemoryEnrichmentParsed | null {
  let data: unknown
  try {
    data = JSON.parse(raw) as unknown
  } catch {
    return null
  }
  if (!data || typeof data !== 'object') {
    return null
  }
  const o = data as Record<string, unknown>
  const entIn = Array.isArray(o.entities) ? o.entities : []
  const entities: MemoryEnrichmentEntity[] = []
  for (const e of entIn) {
    if (!e || typeof e !== 'object') {
      continue
    }
    const r = e as Record<string, unknown>
    const canonicalLabel = clampStr(r.canonicalLabel ?? r.canonical_label, 1000)
    if (!canonicalLabel) {
      continue
    }
    entities.push({
      surfaceForm: clampStr(r.surfaceForm ?? r.surface_form, 500) || canonicalLabel,
      entityType: clampStr(r.entityType ?? r.entity_type, 120) || 'other',
      canonicalLabel,
      confidence: numOrNull(r.confidence),
      contactId: clampStr(r.contactId ?? r.contact_id, 200) || null,
      notes: clampStr(r.notes, 2000) || null,
    })
  }

  const evIn = Array.isArray(o.events) ? o.events : []
  const events: MemoryEnrichmentEvent[] = []
  for (const e of evIn) {
    if (!e || typeof e !== 'object') {
      continue
    }
    const r = e as Record<string, unknown>
    const summary = clampStr(r.summary, 4000)
    if (!summary) {
      continue
    }
    events.push({
      kind: clampStr(r.kind, 120) || 'other',
      summary,
      entitiesTouched: strArr(r.entitiesTouched ?? r.entities_touched),
      orderingHint: clampStr(r.ordering ?? r.ordering_hint, 500) || null,
      recurrence: clampStr(r.recurrence, 500) || null,
      dueHint: parseDue(r.dueHint ?? r.due_hint),
      confidence: numOrNull(r.confidence),
    })
  }

  let narrativeDelta: MemoryEnrichmentNarrativeDelta | null = null
  const nd = o.narrativeDelta ?? o.narrative_delta
  if (nd && typeof nd === 'object') {
    const n = nd as Record<string, unknown>
    narrativeDelta = {
      narrativeMarkdown: clampStr(n.narrativeMarkdown ?? n.narrative_markdown, 8000),
      internalSummary: clampStr(n.internalSummary ?? n.internal_summary, 4000),
      conflicts: n.conflicts ?? null,
      confidence: numOrNull(n.confidence),
    }
  }

  return { entities, events, narrativeDelta }
}

const memoryJsonStrict = (): boolean => {
  const v = process.env.OPENROUTER_MEMORY_JSON_STRICT?.trim().toLowerCase()
  if (v === '0' || v === 'false') {
    return false
  }
  return true
}

/**
 * Returns null when API key missing, request fails, or JSON invalid.
 */
export async function openRouterMemoryEnrichment(
  input: MemoryEnrichmentOpenRouterInput,
): Promise<MemoryEnrichmentParsed | null> {
  const key = process.env.OPENROUTER_API_KEY?.trim()
  if (!key) {
    return null
  }

  const model =
    process.env.OPENROUTER_MEMORY_MODEL?.trim() ||
    process.env.OPENROUTER_MODEL?.trim() ||
    'openai/gpt-4o-mini'

  const userBlock = [
    `userId=${input.userId}`,
    `threadId=${input.threadId}`,
    `inboundMessageId=${input.inboundMessageId}`,
    '',
    'Latest user message:',
    input.rawText.slice(0, 16_000),
    '',
    'Known contact / relationship hints:',
    input.knownContactHints.length ? input.knownContactHints.map(h => `- ${h}`).join('\n') : '(none)',
    '',
    'Prior narrative (internal, may be empty):',
    input.priorNarrativeInternal.slice(0, 4000) || '(none)',
    '',
    'Recent event summaries from DB:',
    input.recentEventSummaries.length
      ? input.recentEventSummaries.map(s => `- ${s.slice(0, 400)}`).join('\n')
      : '(none)',
  ].join('\n')

  const headers = {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...(process.env.OPENROUTER_HTTP_REFERER
      ? { 'HTTP-Referer': process.env.OPENROUTER_HTTP_REFERER }
      : {}),
    'X-Title': 'MiraChat memory enrichment',
  }

  const messages = [
    { role: 'system' as const, content: buildSystemPrompt() },
    { role: 'user' as const, content: userBlock },
  ]

  const basePayload = {
    model,
    messages,
    max_tokens: 1800,
    temperature: 0.2,
  }

  const strict = memoryJsonStrict()
  let res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(
      strict ? { ...basePayload, response_format: { type: 'json_object' } } : basePayload,
    ),
  })

  if (!res.ok && strict && (res.status === 400 || res.status === 422)) {
    const errPeek = await res.text().catch(() => '')
    console.warn(
      'OpenRouter memory: response_format json_object rejected; retrying without it',
      res.status,
      errPeek.slice(0, 400),
    )
    res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(basePayload),
    })
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    console.error('OpenRouter memory enrichment failed', res.status, errText.slice(0, 500))
    return null
  }

  const data: unknown = await res.json().catch(() => null)
  const text = data ? parseOpenRouterChatCompletionContent(data) : null
  if (!text) {
    console.error('OpenRouter memory: missing choices[0].message.content')
    return null
  }
  if (process.env.OPENROUTER_LOG_RAW_CONTENT === '1') {
    console.error('[OpenRouter memory raw]\n', text)
  }
  return parseMemoryEnrichmentJson(text)
}
