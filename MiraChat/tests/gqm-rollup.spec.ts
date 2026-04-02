/**
 * GQM §4 dashboard — queryGqmRollup (drafts approved without edits rate, event counts).
 */
import { describe, it, expect, vi } from 'vitest'
import type { Pool } from 'pg'
import { queryGqmRollup } from '@delegate-ai/db'

describe('GQM rollup (queryGqmRollup)', () => {
  it('computes approvalWithoutEditRate from delegation_events aggregates', async () => {
    const since = new Date('2026-01-01T00:00:00Z')
    const until = new Date('2026-01-08T00:00:00Z')
    const pool = {
      query: vi.fn(async (text: string) => {
        if (/SELECT event_type, COUNT\(\*\)/.test(text)) {
          return {
            rows: [
              { event_type: 'draft.approved_as_is', c: '70' },
              { event_type: 'draft.approved_with_edit', c: '30' },
              { event_type: 'policy.evaluated', c: '100' },
            ],
          }
        }
        if (/SELECT policy_action, COUNT\(\*\)/.test(text)) {
          return {
            rows: [
              { policy_action: 'REVIEW', c: '60' },
              { policy_action: 'BLOCK', c: '5' },
            ],
          }
        }
        if (/COUNT\(DISTINCT user_id\)::text AS active_users/.test(text)) {
          return { rows: [{ active_users: '1', active_threads: '2' }] }
        }
        if (/AVG\(EXTRACT\(EPOCH FROM \(d\.created_at - i\.received_at\)\)\)/.test(text)) {
          return {
            rows: [
              {
                avg_draft_latency_seconds: 12,
                avg_approval_latency_seconds: 30,
                avg_send_latency_seconds: 5,
                avg_resolution_seconds: 47,
              },
            ],
          }
        }
        if (/FROM relationship_graph rg/.test(text) && /memory_chunks mc/.test(text)) {
          return {
            rows: [
              {
                relationship_count: '3',
                high_risk_relationship_count: '1',
                auto_reply_enabled_count: '0',
                hard_constraint_count: '2',
                memory_chunk_count: '8',
              },
            ],
          }
        }
        if (/feedback\.sounds_like_me/.test(text) && /feedback\.regret/.test(text)) {
          return {
            rows: [
              {
                avg_sounds_like_me_score: null,
                sounds_like_me_count: '0',
                regret_count: '0',
                boundary_violation_count: '0',
              },
            ],
          }
        }
        if (/to_char\(created_at::date, 'YYYY-MM-DD'\) AS day/.test(text)) {
          return { rows: [] }
        }
        throw new Error(`gqm-rollup mock: unexpected query ${text.slice(0, 90)}`)
      }),
    } as unknown as Pool

    const rollup = await queryGqmRollup(pool, { userId: null, since, until })

    expect(rollup.asIsApprovals).toBe(70)
    expect(rollup.editedApprovals).toBe(30)
    expect(rollup.approvalWithoutEditRate).toBeCloseTo(70 / 100, 6)
    expect(rollup.policyActionCounts.REVIEW).toBe(60)
    expect(rollup.policyActionCounts.BLOCK).toBe(5)
    expect(rollup.eventCounts['draft.approved_as_is']).toBe(70)
  })

  it('returns null approvalWithoutEditRate when no approval events in window', async () => {
    const pool = {
      query: vi.fn(async (text: string) => {
        if (/SELECT event_type, COUNT\(\*\)/.test(text)) {
          return { rows: [{ event_type: 'inbound.enqueued', c: '3' }] }
        }
        if (/SELECT policy_action, COUNT\(\*\)/.test(text)) {
          return { rows: [] }
        }
        if (/COUNT\(DISTINCT user_id\)::text AS active_users/.test(text)) {
          return { rows: [{ active_users: '0', active_threads: '0' }] }
        }
        if (/AVG\(EXTRACT\(EPOCH FROM \(d\.created_at - i\.received_at\)\)\)/.test(text)) {
          return {
            rows: [
              {
                avg_draft_latency_seconds: null,
                avg_approval_latency_seconds: null,
                avg_send_latency_seconds: null,
                avg_resolution_seconds: null,
              },
            ],
          }
        }
        if (/FROM relationship_graph rg/.test(text) && /memory_chunks mc/.test(text)) {
          return {
            rows: [
              {
                relationship_count: '0',
                high_risk_relationship_count: '0',
                auto_reply_enabled_count: '0',
                hard_constraint_count: '0',
                memory_chunk_count: '0',
              },
            ],
          }
        }
        if (/feedback\.sounds_like_me/.test(text) && /feedback\.regret/.test(text)) {
          return {
            rows: [
              {
                avg_sounds_like_me_score: null,
                sounds_like_me_count: '0',
                regret_count: '0',
                boundary_violation_count: '0',
              },
            ],
          }
        }
        if (/to_char\(created_at::date, 'YYYY-MM-DD'\) AS day/.test(text)) {
          return { rows: [] }
        }
        throw new Error('unexpected')
      }),
    } as unknown as Pool

    const rollup = await queryGqmRollup(pool, {
      userId: null,
      since: new Date(),
      until: new Date(),
    })
    expect(rollup.approvalWithoutEditRate).toBeNull()
    expect(rollup.asIsApprovals).toBe(0)
    expect(rollup.editedApprovals).toBe(0)
  })
})
