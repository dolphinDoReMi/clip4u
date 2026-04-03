import { parseMemoryEnrichmentJson } from '@delegate-ai/agent-core'

describe('parseMemoryEnrichmentJson', () => {
  it('parses entities, events, narrativeDelta (camelCase)', () => {
    const r = parseMemoryEnrichmentJson(
      JSON.stringify({
        entities: [
          {
            surfaceForm: 'Alex',
            entityType: 'contact_candidate',
            canonicalLabel: 'Alex (PM)',
            confidence: 0.9,
            contactId: null,
            notes: 'mentioned standup',
          },
        ],
        events: [
          {
            kind: 'commitment',
            summary: 'Send deck Thursday',
            entitiesTouched: ['Alex'],
            ordering: 'after_previous',
            recurrence: null,
            dueHint: '2026-04-10T12:00:00Z',
            confidence: 0.7,
          },
        ],
        narrativeDelta: {
          narrativeMarkdown: '- Focus on shipping',
          internalSummary: 'User prioritizes delivery.',
          conflicts: [],
          confidence: 0.8,
        },
      }),
    )
    expect(r).not.toBeNull()
    expect(r!.entities).toHaveLength(1)
    expect(r!.entities[0]!.canonicalLabel).toBe('Alex (PM)')
    expect(r!.events).toHaveLength(1)
    expect(r!.events[0]!.dueHint).toBeInstanceOf(Date)
    expect(r!.narrativeDelta?.internalSummary).toContain('prioritizes')
  })

  it('accepts snake_case aliases', () => {
    const r = parseMemoryEnrichmentJson(
      JSON.stringify({
        entities: [
          {
            surface_form: 'Acme',
            entity_type: 'organization',
            canonical_label: 'Acme Corp',
          },
        ],
        events: [{ kind: 'other', summary: 'Ping', entities_touched: ['Acme'] }],
      }),
    )
    expect(r!.entities[0]!.entityType).toBe('organization')
    expect(r!.events[0]!.entitiesTouched).toEqual(['Acme'])
  })

  it('returns null for invalid JSON', () => {
    expect(parseMemoryEnrichmentJson('not json')).toBeNull()
    expect(parseMemoryEnrichmentJson('{}')).not.toBeNull()
  })
})
