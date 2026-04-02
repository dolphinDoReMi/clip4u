import { describe, it, expect, vi } from 'vitest'
import type { Pool } from 'pg'
import { PostgresIdentityService } from '@delegate-ai/db'

describe('PostgresIdentityService', () => {
  it('persists and reloads displayName, tone, styleGuide, and hardBoundaries', async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = []
    const pool = {
      query: vi.fn(async (text: string, values?: unknown[]) => {
        queries.push({ text, values })
        if (/SELECT display_name, tone, style_guide FROM identity_profiles/.test(text)) {
          return {
            rows: [
              {
                display_name: 'Alex Founder',
                tone: 'calm, direct',
                style_guide: ['be concise', 'protect intent'],
              },
            ],
          }
        }
        if (/SELECT constraint_text FROM hard_constraints/.test(text)) {
          return {
            rows: [
              { constraint_text: 'no financial commitments' },
              { constraint_text: 'no legal commitments' },
            ],
          }
        }
        return { rows: [] }
      }),
    } as unknown as Pool

    const service = new PostgresIdentityService(pool)

    await service.upsertIdentity({
      userId: 'user-1',
      displayName: 'Alex Founder',
      tone: 'calm, direct',
      styleGuide: ['be concise', 'protect intent'],
      hardBoundaries: ['no financial commitments', 'no legal commitments'],
    })

    const profile = await service.getIdentity('user-1')

    expect(profile.displayName).toBe('Alex Founder')
    expect(profile.tone).toBe('calm, direct')
    expect(profile.styleGuide).toEqual(['be concise', 'protect intent'])
    expect(profile.hardBoundaries).toEqual(['no financial commitments', 'no legal commitments'])

    expect(
      queries.some(q => /INSERT INTO identity_profiles/.test(q.text)),
    ).toBe(true)
  })

  it('falls back to defaults when no persisted profile exists', async () => {
    const pool = {
      query: vi.fn(async (text: string) => {
        if (/SELECT display_name, tone, style_guide FROM identity_profiles/.test(text)) {
          return { rows: [] }
        }
        if (/SELECT constraint_text FROM hard_constraints/.test(text)) {
          return { rows: [] }
        }
        return { rows: [] }
      }),
    } as unknown as Pool

    const service = new PostgresIdentityService(pool)
    const profile = await service.getIdentity('user-2')

    expect(profile.displayName).toBe('Mira User')
    expect(profile.hardBoundaries).toContain('no financial commitments')
    expect(profile.styleGuide.length).toBeGreaterThan(0)
  })
})
