import { describe, it, expect } from 'vitest'
import {
  runNegotiationTurn,
  toolProposeSlots,
  toolRecordConstraint,
  validateA2aPayload,
} from '@delegate-ai/negotiation-tools'

describe('negotiation tools', () => {
  it('toolProposeSlots returns three slots', () => {
    const r = toolProposeSlots({
      durationMinutes: 30,
      preference: 'morning',
      relationshipPriority: 'high',
    })
    expect(r.slots).toHaveLength(3)
    expect(r.rationale).toContain('high')
  })

  it('toolRecordConstraint normalizes whitespace', () => {
    const r = toolRecordConstraint('  no   meetings  before  10  ')
    expect(r.normalized).toBe('no meetings before 10')
  })

  it('runNegotiationTurn returns reply and state', () => {
    const out = runNegotiationTurn({
      state: {
        threadRef: 't1',
        relationshipPriority: 'normal',
        proposedSlots: [],
        constraints: [],
        lastSpeaker: 'counterparty',
      },
      counterpartyText: 'Thursday 3pm works for me',
    })
    expect(out.reply.length).toBeGreaterThan(10)
    expect(out.state.constraints.length).toBeGreaterThanOrEqual(1)
    expect(out.toolsUsed).toContain('propose_slots')
  })
})

describe('a2a payload guard', () => {
  it('validateA2aPayload accepts plain objects', () => {
    expect(validateA2aPayload({ a: 1 })).toBe(true)
    expect(validateA2aPayload(null)).toBe(false)
    expect(validateA2aPayload([])).toBe(false)
  })
})
