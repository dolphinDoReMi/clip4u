import type { AssistRequest, DelegateDraft, IdentityProfile, RelationshipProfile } from '@delegate-ai/adapter-types'

const compact = (value: string): string => value.replace(/\s+/g, ' ').trim()

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

const safeFirstSentence = (text: string): string => {
  const normalized = compact(text)
  if (!normalized) {
    return ''
  }
  const match = normalized.match(/.+?[.!?](?:\s|$)/)
  return compact(match?.[0] ?? normalized)
}

const extractLatestPrompt = (prompt: string): string => {
  const latestLine = prompt
    .split('\n')
    .map(line => line.trim())
    .find(line => line.toLowerCase().startsWith('latest:'))
  if (latestLine) {
    return compact(latestLine.replace(/^latest:\s*/i, ''))
  }
  return safeFirstSentence(prompt)
}

const inferIntent = (text: string): 'scheduling' | 'finance' | 'decision' | 'general' => {
  const t = text.toLowerCase()
  if (/\b(schedule|calendar|meet|meeting|time|slot|tomorrow|next week|thursday|friday)\b/.test(t)) {
    return 'scheduling'
  }
  if (/\b(invoice|payment|wire|budget|price|cost|pay)\b/.test(t)) {
    return 'finance'
  }
  if (/\b(review|approve|decision|confirm|share|send|follow up)\b/.test(t)) {
    return 'decision'
  }
  return 'general'
}

const relationshipLabel = (relationship: RelationshipProfile): string =>
  relationship.role !== 'unknown' ? relationship.role : 'contact'

const baseReply = (latest: string, relationship: RelationshipProfile, identity: IdentityProfile): string => {
  const intent = inferIntent(latest)
  const role = relationshipLabel(relationship)

  if (intent === 'finance') {
    return `Thanks for checking. I want to stay within my boundaries here, so I am not going to confirm any financial commitment in chat. Please send the details and I will review them before replying.`
  }

  if (intent === 'scheduling') {
    return `Thanks for reaching out. Happy to coordinate from here. Please send two or three windows that work on your side and I will confirm the best option.`
  }

  if (intent === 'decision') {
    return `Thanks for the note. I have the context I need and will follow up with a clear answer shortly. If there is a hard deadline, send it over and I will prioritize it.`
  }

  const displayName = identity.displayName || 'I'
  return `Thanks for the message. I have it, and I will reply in a ${relationship.tone} way that fits this ${role} relationship. If there is anything time-sensitive, please flag it and I will prioritize it.`
    .replace(displayName, compact(displayName))
}

const renderVariant = (
  variant: 'concise' | 'warm' | 'assertive',
  latest: string,
  relationship: RelationshipProfile,
  identity: IdentityProfile,
): string => {
  const base = baseReply(latest, relationship, identity)
  if (variant === 'concise') {
    return compact(
      base
        .replace('Happy to coordinate from here. ', '')
        .replace('Please send two or three windows that work on your side and I will confirm the best option.', 'Send two or three windows that work for you and I will confirm.')
        .replace('If there is anything time-sensitive, please flag it and I will prioritize it.', 'Flag anything urgent.'),
    )
  }
  if (variant === 'warm') {
    return compact(`Thanks for reaching out. ${base} I appreciate the context and will keep the next step straightforward.`)
  }
  return compact(
    base
      .replace('I have the context I need and will follow up with a clear answer shortly.', 'I have enough context to move this forward and will send a clear answer shortly.')
      .replace('Please send the details and I will review them before replying.', 'Send the details and I will review them before responding.')
      .replace('Please send two or three windows that work on your side and I will confirm the best option.', 'Send two or three workable windows and I will lock the best one.'),
  )
}

export class AssistService {
  async suggestReplies(input: {
    request: AssistRequest
    identity: IdentityProfile
    relationship: RelationshipProfile
  }): Promise<DelegateDraft[]> {
    const latest = extractLatestPrompt(input.request.prompt)
    const variants: Array<{ variant: 'concise' | 'warm' | 'assertive'; reason: string; confidence: number }> = [
      { variant: 'concise', reason: 'Short draft optimized for low-friction reply', confidence: 0.79 },
      { variant: 'warm', reason: 'Relationship-preserving draft with more warmth', confidence: 0.76 },
      { variant: 'assertive', reason: 'Direct draft that preserves boundaries and next step', confidence: 0.74 },
    ]

    return variants.map(({ variant, reason, confidence }, index) => ({
      id: `assist-${Date.now()}-${index + 1}`,
      mode: 'assist',
      response: renderVariant(variant, latest, input.relationship, input.identity),
      confidence: clamp(confidence - (input.relationship.riskLevel === 'high' ? 0.08 : 0), 0.52, 0.88),
      reasons: [reason],
      memoryRefs: [],
      createdAt: Date.now(),
    }))
  }
}
