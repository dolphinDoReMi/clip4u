import type {
  ContextBundle,
  DelegateDraft,
  IdentityService,
  MemoryService,
  MessageEvent,
} from '@delegate-ai/adapter-types'
import { openRouterAnalysisAssist } from './openrouter-assist.js'

export interface IntentSignal {
  domain: string
  urgency: 'low' | 'normal' | 'high'
  summary: string
}

const compact = (value: string): string => value.replace(/\s+/g, ' ').trim()

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

const unique = <T>(items: T[]): T[] => [...new Set(items)]

const latestSentence = (text: string): string => {
  const normalized = compact(text)
  if (!normalized) {
    return ''
  }
  const match = normalized.match(/.+?[.!?](?:\s|$)/)
  return compact(match?.[0] ?? normalized)
}

const isSimpleAcknowledgement = (text: string): boolean =>
  /^\s*(thanks|thank you|got it|sounds good|ok|okay|noted)[.!]?\s*$/i.test(text)

const isLowSignalContext = (text: string): boolean => {
  const normalized = compact(text)
  if (!normalized) {
    return true
  }
  if (normalized.startsWith('/')) {
    return true
  }
  if (
    /^(thanks for the message|thanks for reaching out|got it|happy to coordinate this|thanks for the note)\b/i.test(
      normalized,
    )
  ) {
    return true
  }
  if (isSimpleAcknowledgement(normalized)) {
    return true
  }
  const wordCount = normalized.split(/\s+/).length
  return wordCount < 3 && normalized.length < 18
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

const planner = async (context: ContextBundle): Promise<{ instruction: string; intent: IntentSignal }> => {
  const intent = classifyIntent(context.event)
  const base = `Reply in a ${context.relationship.tone} tone while honoring: ${context.identity.hardBoundaries.join(', ')}`
  const assist = context.memory.analysisAssist?.trim()
  if (!assist) {
    return { instruction: base, intent }
  }
  return {
    instruction: `${base}\n\nExternal analysis (for drafting context, not verbatim):\n${assist}`,
    intent,
  }
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
  const body =
    input.plan.intent.domain === 'finance'
      ? draftFinanceBoundaryReply(input.context)
      : input.plan.intent.domain === 'scheduling'
        ? draftSchedulingReply(input.context)
        : input.plan.intent.domain === 'delivery'
          ? draftDeliveryReply(input.context)
          : input.plan.intent.domain === 'follow_up'
            ? draftFollowUpReply()
            : draftGeneralReply(input.context, contextSignals)
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
  const [identity, relationship, recentMessages, searchMatches] = await Promise.all([
    services.identityService.getIdentity(event.userId),
    services.identityService.getRelationship(event.userId, event.senderId),
    services.memoryService.getRecentMessages(event.threadId, undefined, event.userId),
    services.memoryService.searchMessages(event.userId, event.text),
  ])

  const analysisAssist = await openRouterAnalysisAssist({
    latestUserText: event.text,
    recentMessages,
    searchMatches,
  })

  return {
    event,
    identity,
    relationship,
    memory: { recentMessages, searchMatches, analysisAssist },
  }
}

export const runCognitivePipeline = async (context: ContextBundle): Promise<DelegateDraft> => {
  const plan = await planner(context)
  const execution = await executor({ context, plan })
  return evaluator({ context, execution })
}
