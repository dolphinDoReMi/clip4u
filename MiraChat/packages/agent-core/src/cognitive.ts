import type {
  ContextBundle,
  DelegateDraft,
  IdentityService,
  MemoryService,
  MessageEvent,
  StoredMessage,
} from '@delegate-ai/adapter-types'
import {
  isOpenRouterPrimaryDraftEnabled,
  openRouterAnalysisAssist,
  openRouterPrimaryReplyDraft,
} from './openrouter-assist.js'
import { isLowSignalInboundText, isReferentialFollowUpText, isSimpleAcknowledgement } from './message-signals.js'

export interface IntentSignal {
  domain: string
  urgency: 'low' | 'normal' | 'high'
  summary: string
}

const compact = (value: string): string => value.replace(/\s+/g, ' ').trim()

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

const unique = <T>(items: T[]): T[] => [...new Set(items)]

const envTruthy = (name: string): boolean => {
  const v = process.env[name]?.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes' || v === 'on'
}

const latestSentence = (text: string): string => {
  const normalized = compact(text)
  if (!normalized) {
    return ''
  }
  const match = normalized.match(/.+?[.!?](?:\s|$)/)
  return compact(match?.[0] ?? normalized)
}

const isLowSignalContext = (text: string): boolean => isLowSignalInboundText(text)

const searchQueryForInbound = (
  eventText: string,
  recentMessages: StoredMessage[],
  relationshipNotes: string[],
): string => {
  const t = compact(eventText)
  if (!isLowSignalInboundText(t)) {
    return t
  }
  const mem = recentMessages
    .filter(m => m.channel === 'memory')
    .map(m => m.content.trim())
    .filter(Boolean)
    .join('\n')
  const notes = relationshipNotes.map(n => n.trim()).filter(Boolean).join('\n')
  const merged = compact([mem, notes, t].filter(Boolean).join('\n'))
  return merged.slice(0, 2000) || t
}

export const classifyIntent = (event: MessageEvent): IntentSignal => {
  const t = event.text.toLowerCase()
  let domain = 'general'
  if (/schedule|calendar|meet|thursday|monday|tomorrow|next week/.test(t)) {
    domain = 'scheduling'
  }
  if (/budget|invoice|pay|price|cost/.test(t)) {
    domain = 'finance'
  }
  if (/launch|ship|deadline|milestone/.test(t)) {
    domain = 'delivery'
  }
  if (/follow up|check in|circle back|nudge/.test(t)) {
    domain = 'follow_up'
  }
  const urgency: IntentSignal['urgency'] =
    /no rush|whenever|next month/.test(t) ? 'low' : /urgent|asap|today|now|critical/.test(t) ? 'high' : 'normal'
  return { domain, urgency, summary: humanIntentLine(domain, urgency, event.text) }
}

const humanIntentLine = (domain: string, urgency: IntentSignal['urgency'], raw: string): string => {
  const urgencyBit =
    urgency === 'high' ? 'Time-sensitive.' : urgency === 'low' ? 'No rush implied.' : 'Standard priority.'
  const clip = compact(raw)
  const short = clip.length > 140 ? `${clip.slice(0, 137)}…` : clip
  switch (domain) {
    case 'scheduling':
      return `They want to coordinate time or calendar. ${urgencyBit}`
    case 'finance':
      return `Money, invoice, payment, or budget—avoid casual commitments. ${urgencyBit}`
    case 'delivery':
      return `Project status, shipping, or deadlines. ${urgencyBit}`
    case 'follow_up':
      return `They’re checking in or waiting on you. ${urgencyBit}`
    default:
      return short
        ? `Latest from them: “${short}”. ${urgencyBit}`
        : `Inbound message. ${urgencyBit}`
  }
}

const structuredRecallBlock = (context: ContextBundle): string => {
  const attended = context.memory.attendedRecall?.trim()
  if (attended) {
    return `\n\nAttended Ledger (Relevant Facts):\n${attended}`
  }
  
  const sr = context.memory.structuredRecall
  if (!sr) {
    return ''
  }
  const parts: string[] = []
  const internal = sr.internalSummary?.trim()
  const ent = sr.entityBullets?.trim()
  const ev = sr.eventBullets?.trim()
  if (internal) {
    parts.push(`Structured user narrative: ${internal}`)
  }
  if (ent) {
    parts.push(`Remembered entities:\n${ent}`)
  }
  if (ev) {
    parts.push(`Recent timeline / commitments:\n${ev}`)
  }
  return parts.length > 0 ? `\n\n${parts.join('\n\n')}` : ''
}

const planner = async (context: ContextBundle): Promise<{ instruction: string; intent: IntentSignal }> => {
  const intent = classifyIntent(context.event)
  const base = `Reply in a ${context.relationship.tone} tone while honoring: ${context.identity.hardBoundaries.join(', ')}`
  let instruction = `${base}${structuredRecallBlock(context)}`
  const assist = context.memory.analysisAssist?.trim()
  if (assist) {
    instruction = `${instruction}\n\nExternal analysis (for drafting context, not verbatim):\n${assist}`
  }
  return { instruction, intent }
}

const summarizePriorContext = (context: ContextBundle): string[] => {
  const recentInbound = context.memory.recentMessages
    .filter(message => message.direction === 'inbound' && message.id !== context.event.messageId)
    .slice(-2)
    .map(message => latestSentence(message.content))
    .filter(message => message && !isLowSignalContext(message))
  const priorOutbound = context.memory.recentMessages
    .filter(message => message.direction === 'outbound')
    .slice(-2)
    .map(message => latestSentence(message.content))
    .filter(message => message && !isLowSignalContext(message))
  const searchHints = context.memory.searchMatches
    .filter(message => message.threadId !== context.event.threadId)
    .slice(0, 2)
    .map(message => latestSentence(message.content))
    .filter(message => message && !isLowSignalContext(message))

  return unique([...priorOutbound, ...recentInbound, ...searchHints]).slice(0, 4)
}

const relationshipTonePhrase = (context: ContextBundle): string => {
  const tone = compact(context.relationship.tone || '')
  return tone && tone !== 'warm' ? tone : ''
}

const draftSchedulingReply = (context: ContextBundle): string => {
  const warmOpen = context.relationship.tone.includes('warm') ? 'Thanks for reaching out.' : 'Thanks for the note.'
  return compact(
    `${warmOpen} Happy to coordinate this. Please send two or three windows that work on your side and I will confirm the best option from there.`,
  )
}

const draftFinanceBoundaryReply = (context: ContextBundle): string => {
  const boundary =
    context.identity.hardBoundaries[0] ?? 'I am not making commitments until I have reviewed the details.'
  return compact(
    `Thanks for checking. I want to stay within my boundaries here, so I am not going to confirm a financial commitment in chat. Please send the details and I will review them first. (${boundary})`,
  )
}

const draftDeliveryReply = (context: ContextBundle): string => {
  const role = context.relationship.role !== 'unknown' ? context.relationship.role : 'thread'
  const tone = relationshipTonePhrase(context)
  return compact(
    `Thanks for the update. I have the current ${role} context and will keep things moving${tone ? ` in a ${tone} tone` : ''}. If timing changes or there is a blocker, send the latest status and I will adjust from there.`,
  )
}

const draftFollowUpReply = (): string =>
  'Thanks for the reminder. I have this on my list and will follow up with a concrete update shortly.'

const draftReferentialClarifier = (context: ContextBundle): string => {
  const opener = context.relationship.tone.includes('warm')
    ? 'Happy to take a look.'
    : 'I can review it.'
  return compact(
    `${opener} Please send the new screenshot, file, or details you want me to review so I can respond to the right item.`,
  )
}

const draftGeneralReply = (context: ContextBundle, signals: string[]): string => {
  const opener = context.relationship.tone.includes('warm')
    ? 'Thanks for the message.'
    : 'Got it.'
  const bridge = signals.length > 0
    ? ` This lines up with the recent context around ${signals[0]}.`
    : ''
  const urgencyLine = classifyIntent(context.event).urgency === 'high'
    ? ' I will prioritize it and get back to you soon.'
    : ' I will follow up with a clear next step shortly.'
  const boundaryNote =
    context.identity.hardBoundaries.length > 0
      ? ` I stay within: ${context.identity.hardBoundaries.join(', ')}.`
      : ''
  const toneNote = relationshipTonePhrase(context) ? ` I will keep the reply ${relationshipTonePhrase(context)}.` : ''
  return compact(`${opener}${bridge}${urgencyLine}${toneNote}${boundaryNote}`)
}

const executor = async (input: {
  context: ContextBundle
  plan: { instruction: string; intent: IntentSignal }
}): Promise<{ response: string }> => {
  const contextSignals = summarizePriorContext(input.context)
  const referentialFollowUp = isReferentialFollowUpText(input.context.event.text)
  const body =
    referentialFollowUp
      ? draftReferentialClarifier(input.context)
      : input.plan.intent.domain === 'finance'
      ? draftFinanceBoundaryReply(input.context)
      : input.plan.intent.domain === 'scheduling'
        ? draftSchedulingReply(input.context)
        : input.plan.intent.domain === 'delivery'
          ? draftDeliveryReply(input.context)
          : input.plan.intent.domain === 'follow_up'
            ? draftFollowUpReply()
            : (await openRouterPrimaryReplyDraft(input.context, input.plan.instruction)) ??
              draftGeneralReply(input.context, contextSignals)
  return {
    response: compact(body),
  }
}

const evaluator = async (input: {
  context: ContextBundle
  execution: { response: string }
}): Promise<DelegateDraft> => {
  const intent = classifyIntent(input.context.event)
  const hasRecentContext = input.context.memory.recentMessages.length > 0
  const hasCrossThreadContext = input.context.memory.searchMatches.length > 0
  const riskPenalty =
    input.context.relationship.riskLevel === 'high'
      ? 0.18
      : input.context.relationship.riskLevel === 'medium'
        ? 0.08
        : 0
  const sensitivityPenalty = intent.domain === 'finance' ? 0.18 : 0
  const confidence = clamp(
    0.64 +
      (intent.domain !== 'general' ? 0.08 : 0) +
      (isSimpleAcknowledgement(input.context.event.text) ? 0.22 : 0) +
      (hasRecentContext ? 0.07 : 0) +
      (hasCrossThreadContext ? 0.04 : 0) -
      riskPenalty -
      sensitivityPenalty,
    0.46,
    0.93,
  )

  return {
    id: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    mode: 'approve',
    response: input.execution.response,
    confidence,
    reasons: unique([
      `intent=${intent.domain}`,
      'draft grounded in identity and relationship',
      hasRecentContext ? 'recent thread context used' : 'limited recent thread context',
      hasCrossThreadContext ? 'cross-thread recall used' : 'no cross-thread recall match',
    ]),
    memoryRefs: unique([
      ...input.context.memory.recentMessages.map(m => m.id),
      ...input.context.memory.searchMatches.map(m => m.id),
    ]),
    createdAt: Date.now(),
  }
}

export const buildContextBundle = async (
  services: { identityService: IdentityService; memoryService: MemoryService },
  event: MessageEvent,
): Promise<ContextBundle> => {
  const [identity, relationship, recentMessages] = await Promise.all([
    services.identityService.getIdentity(event.userId),
    services.identityService.getRelationship(event.userId, event.senderId),
    services.memoryService.getRecentMessages(event.threadId, undefined, event.userId),
  ])

  const q = searchQueryForInbound(event.text, recentMessages, relationship.notes)
  const searchMatches = await services.memoryService.searchMessages(event.userId, q, undefined, {
    threadId: event.threadId,
  })

  const intent = classifyIntent(event)
  const skipAnalysisAssist =
    envTruthy('OPENROUTER_SKIP_ANALYSIS_ASSIST') ||
    (!envTruthy('OPENROUTER_FORCE_ANALYSIS_ASSIST') &&
      intent.domain === 'general' &&
      isOpenRouterPrimaryDraftEnabled() &&
      !isLowSignalInboundText(event.text))

  const analysisAssist = skipAnalysisAssist
    ? null
    : await openRouterAnalysisAssist({
        latestUserText: event.text,
        recentMessages,
        searchMatches,
      })

  const structuredRecall = services.memoryService.getStructuredRecall
    ? await services.memoryService.getStructuredRecall(event.userId, event.threadId)
    : null

  let attendedRecall: string | null = null
  if (structuredRecall) {
    const { openRouterMemoryAttention } = await import('./openrouter-assist.js')
    attendedRecall = await openRouterMemoryAttention({
      latestUserText: event.text,
      recentMessages,
      structuredRecall,
    })
  }

  return {
    event,
    identity,
    relationship,
    memory: { recentMessages, searchMatches, analysisAssist, structuredRecall, attendedRecall },
  }
}

export const runCognitivePipeline = async (context: ContextBundle): Promise<DelegateDraft> => {
  const plan = await planner(context)
  const execution = await executor({ context, plan })
  return evaluator({ context, execution })
}
