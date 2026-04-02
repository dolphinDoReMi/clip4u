/**
 * PRD scheduling / soft-negotiation tools — deterministic helpers for agent tool-calling.
 * Relationship-priority hints are inputs; no calendar API here.
 */

export interface NegotiationState {
  threadRef: string
  relationshipPriority: 'critical' | 'high' | 'normal' | 'defer'
  proposedSlots: string[]
  constraints: string[]
  lastSpeaker: 'user' | 'counterparty' | 'system'
}

export interface ProposeSlotsInput {
  durationMinutes: number
  preference: 'morning' | 'afternoon' | 'flex'
  relationshipPriority: NegotiationState['relationshipPriority']
}

/** Suggest concrete slot labels (no external calendar). */
export function toolProposeSlots(input: ProposeSlotsInput): { slots: string[]; rationale: string } {
  const base =
    input.preference === 'morning'
      ? ['Tue 10:00', 'Wed 09:30', 'Thu 10:30']
      : input.preference === 'afternoon'
        ? ['Tue 15:00', 'Wed 16:00', 'Thu 14:30']
        : ['Tue 11:00', 'Wed 14:00', 'Thu 10:00']
  const defer = input.relationshipPriority === 'defer' ? ' (lower priority — wider windows acceptable)' : ''
  return {
    slots: base,
    rationale: `Proposed ${input.durationMinutes}m holds; relationship weight=${input.relationshipPriority}${defer}`,
  }
}

export function toolRecordConstraint(text: string): { stored: string; normalized: string } {
  const normalized = text.trim().replace(/\s+/g, ' ')
  return { stored: normalized, normalized }
}

export interface CounterOfferInput {
  state: NegotiationState
  counterpartyText: string
}

/** Lightweight turn: merge counterparty text into constraints and suggest next reply skeleton. */
export function runNegotiationTurn(input: CounterOfferInput): {
  reply: string
  state: NegotiationState
  toolsUsed: string[]
} {
  const toolsUsed: string[] = ['record_constraint']
  const c = toolRecordConstraint(input.counterpartyText)
  const nextConstraints = [...input.state.constraints, c.normalized].slice(-12)
  const priority = input.state.relationshipPriority
  const slots = toolProposeSlots({
    durationMinutes: 30,
    preference: 'flex',
    relationshipPriority: priority,
  })
  toolsUsed.push('propose_slots')
  const reply = `Acknowledge their note ("${c.normalized.slice(0, 80)}${c.normalized.length > 80 ? '…' : ''}") and offer: ${slots.slots.join(', ')}. Priority: ${priority}.`
  return {
    reply,
    state: {
      ...input.state,
      constraints: nextConstraints,
      proposedSlots: slots.slots,
      lastSpeaker: 'system',
    },
    toolsUsed,
  }
}

export function validateA2aPayload(payload: unknown): payload is Record<string, unknown> {
  return typeof payload === 'object' && payload !== null && !Array.isArray(payload)
}
