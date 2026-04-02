/**
 * PRD pipeline: inbound job → policy → outbound draft + GQM delegation_events (mirachat-worker).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Pool } from 'pg'
import { DelegationEventType, POLICY_ENGINE_ID } from '@delegate-ai/db'
import { InMemoryIdentityService } from '@delegate-ai/identity'
import { InMemoryMemoryService } from '@delegate-ai/memory'
import type { MessageEvent } from '@delegate-ai/adapter-types'

const dbMocks = vi.hoisted(() => ({
  getInboundMessage: vi.fn(),
  setInboundStatus: vi.fn(),
  insertOutboundDraft: vi.fn(),
  insertDelegationEvent: vi.fn(),
  rejectSupersededDraftsForThread: vi.fn(),
}))

vi.mock('@delegate-ai/db', async importOriginal => {
  const actual = await importOriginal<typeof import('@delegate-ai/db')>()
  return {
    ...actual,
    getInboundMessage: dbMocks.getInboundMessage,
    setInboundStatus: dbMocks.setInboundStatus,
    insertOutboundDraft: dbMocks.insertOutboundDraft,
    insertDelegationEvent: dbMocks.insertDelegationEvent,
    rejectSupersededDraftsForThread: dbMocks.rejectSupersededDraftsForThread,
  }
})

import { processInboundJob } from '../services/api/src/mirachat-worker.ts'

const baseInboundRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'in-1',
  user_connection_id: null,
  contact_id: 'c1',
  room_id: null,
  thread_id: 'thread-1',
  raw_text: 'Hello',
  received_at: new Date(),
  status: 'PENDING' as const,
  channel: 'whatsapp',
  account_id: 'acc1',
  user_id: 'u1',
  sender_id: 's1',
  message_id: 'm1',
  error: null as string | null,
  ...overrides,
})

describe('mirachat-worker processInboundJob (PRD §5 / GQM instrumentation)', () => {
  const noopPool = {} as Pool

  beforeEach(() => {
    vi.resetAllMocks()
    dbMocks.setInboundStatus.mockResolvedValue(undefined)
    dbMocks.insertDelegationEvent.mockResolvedValue(undefined)
    dbMocks.rejectSupersededDraftsForThread.mockResolvedValue([])
    dbMocks.insertOutboundDraft.mockImplementation(async (_pool, input) => ({
      id: 'draft-out-1',
      inbound_message_id: input.inboundMessageId,
      generated_text: input.generatedText,
      confidence_score: input.confidenceScore,
      status: input.status,
      rule_triggered: input.ruleTriggered,
      channel: input.channel,
      account_id: input.accountId,
      user_id: input.userId,
      thread_id: input.threadId,
      intent_summary: input.intentSummary,
      reply_options: input.replyOptions ?? null,
      thread_summary: input.threadSummary ?? null,
      edited_text: null,
      approved_at: input.approvedAt ?? null,
      sent_at: null,
      send_attempt_count: 0,
      last_send_attempt_at: null,
      last_send_error: null,
      next_send_after: null,
      dead_lettered_at: null,
      created_at: new Date('2020-01-01T00:00:00.000Z'),
      updated_at: new Date('2020-01-01T00:00:00.000Z'),
    }))
  })

  it('writes policy.evaluated + draft.created, inserts DRAFTED outbound for safe path (G1/G4)', async () => {
    dbMocks.getInboundMessage.mockResolvedValue(baseInboundRow())
    const identity = new InMemoryIdentityService()
    const memory = new InMemoryMemoryService()

    await processInboundJob(noopPool, identity, memory, 'in-1')

    expect(dbMocks.setInboundStatus).toHaveBeenCalledWith(noopPool, 'in-1', 'PROCESSING')
    expect(dbMocks.setInboundStatus).toHaveBeenCalledWith(noopPool, 'in-1', 'DONE')

    const policyCalls = dbMocks.insertDelegationEvent.mock.calls.filter(
      c => (c[1] as { eventType: string }).eventType === DelegationEventType.PolicyEvaluated,
    )
    expect(policyCalls.length).toBe(1)
    expect(policyCalls[0]![1]).toMatchObject({
      eventType: DelegationEventType.PolicyEvaluated,
      userId: 'u1',
      policyRuleId: POLICY_ENGINE_ID,
      metadata: expect.objectContaining({
        intent_domain: expect.any(String),
        policy_reasons: expect.any(Array),
      }),
    })

    const draftCreated = dbMocks.insertDelegationEvent.mock.calls.find(
      c => (c[1] as { eventType: string }).eventType === DelegationEventType.DraftCreated,
    )
    expect(draftCreated).toBeDefined()
    expect(draftCreated![1]).toMatchObject({
      eventType: DelegationEventType.DraftCreated,
      draftId: 'draft-out-1',
      metadata: expect.objectContaining({ outbound_status: 'DRAFTED' }),
    })

    expect(dbMocks.insertOutboundDraft).toHaveBeenCalledWith(
      noopPool,
      expect.objectContaining({
        status: 'DRAFTED',
        inboundMessageId: 'in-1',
        replyOptions: expect.any(Array),
      }),
    )
  })

  it('REJECTED outbound + blocked summary when transcript triggers hard boundary (G1)', async () => {
    dbMocks.getInboundMessage.mockResolvedValue(
      baseInboundRow({ thread_id: 't-money', raw_text: 'ack' }),
    )
    const identity = new InMemoryIdentityService()
    const memory = new InMemoryMemoryService()
    const seed: MessageEvent = {
      channel: 'whatsapp',
      accountId: 'acc1',
      userId: 'u1',
      senderId: 's1',
      threadId: 't-money',
      messageId: 'pre',
      text: 'Please complete the wire transfer for the invoice today.',
      timestamp: Date.now(),
      threadType: 'dm',
    }
    await memory.recordIncoming(seed)

    await processInboundJob(noopPool, identity, memory, 'in-1')

    expect(dbMocks.insertOutboundDraft).toHaveBeenCalledWith(
      noopPool,
      expect.objectContaining({
        status: 'REJECTED',
        threadSummary: expect.stringMatching(/Policy blocked/i),
        replyOptions: null,
      }),
    )
  })

  it('REJECTED outbound when finance intent produces boundary wording in draft (real DB regression)', async () => {
    dbMocks.getInboundMessage.mockResolvedValue(
      baseInboundRow({
        thread_id: 't-finance',
        raw_text: 'Please confirm you will pay the invoice and send the wire transfer today.',
      }),
    )
    const identity = new InMemoryIdentityService()
    const memory = new InMemoryMemoryService()

    await processInboundJob(noopPool, identity, memory, 'in-1')

    expect(dbMocks.insertOutboundDraft).toHaveBeenCalledWith(
      noopPool,
      expect.objectContaining({
        status: 'REJECTED',
        ruleTriggered: 'financial_commitment_or_hard_boundary',
        threadSummary: expect.stringMatching(/Policy blocked/i),
        replyOptions: null,
      }),
    )
  })

  it('Twilio + v2 env flags → APPROVED outbound (AUTO_SEND), no reply options', async () => {
    const prevAllow = process.env.MIRACHAT_ALLOW_AUTO_SEND
    const prevTwilio = process.env.MIRACHAT_TWILIO_AUTO_SEND
    process.env.MIRACHAT_ALLOW_AUTO_SEND = 'true'
    process.env.MIRACHAT_TWILIO_AUTO_SEND = 'true'
    try {
      dbMocks.getInboundMessage.mockResolvedValue(
        baseInboundRow({
          channel: 'twilio_sms',
          raw_text: 'Thanks.',
        }),
      )
      const identity = new InMemoryIdentityService()
      await identity.upsertRelationship({
        userId: 'u1',
        contactId: 's1',
        role: 'peer',
        tone: 'warm',
        riskLevel: 'low',
        notes: [],
      })
      const memory = new InMemoryMemoryService()

      await processInboundJob(noopPool, identity, memory, 'in-1')

      expect(dbMocks.insertOutboundDraft).toHaveBeenCalledWith(
        noopPool,
        expect.objectContaining({
          status: 'APPROVED',
          replyOptions: null,
          approvedAt: expect.any(Date),
        }),
      )
    } finally {
      if (prevAllow !== undefined) {
        process.env.MIRACHAT_ALLOW_AUTO_SEND = prevAllow
      } else {
        delete process.env.MIRACHAT_ALLOW_AUTO_SEND
      }
      if (prevTwilio !== undefined) {
        process.env.MIRACHAT_TWILIO_AUTO_SEND = prevTwilio
      } else {
        delete process.env.MIRACHAT_TWILIO_AUTO_SEND
      }
    }
  })

  it('Twilio without MIRACHAT_TWILIO_AUTO_SEND → DRAFTED (human review path)', async () => {
    const prevAllow = process.env.MIRACHAT_ALLOW_AUTO_SEND
    const prevTwilio = process.env.MIRACHAT_TWILIO_AUTO_SEND
    process.env.MIRACHAT_ALLOW_AUTO_SEND = 'true'
    delete process.env.MIRACHAT_TWILIO_AUTO_SEND
    try {
      dbMocks.getInboundMessage.mockResolvedValue(
        baseInboundRow({
          channel: 'twilio_sms',
          raw_text: 'Thanks.',
        }),
      )
      const identity = new InMemoryIdentityService()
      await identity.upsertRelationship({
        userId: 'u1',
        contactId: 's1',
        role: 'peer',
        tone: 'warm',
        riskLevel: 'low',
        notes: [],
      })
      const memory = new InMemoryMemoryService()

      await processInboundJob(noopPool, identity, memory, 'in-1')

      expect(dbMocks.insertOutboundDraft).toHaveBeenCalledWith(
        noopPool,
        expect.objectContaining({
          status: 'DRAFTED',
          replyOptions: expect.any(Array),
        }),
      )
    } finally {
      if (prevAllow !== undefined) {
        process.env.MIRACHAT_ALLOW_AUTO_SEND = prevAllow
      } else {
        delete process.env.MIRACHAT_ALLOW_AUTO_SEND
      }
      if (prevTwilio !== undefined) {
        process.env.MIRACHAT_TWILIO_AUTO_SEND = prevTwilio
      } else {
        delete process.env.MIRACHAT_TWILIO_AUTO_SEND
      }
    }
  })

  it('skips processing when inbound row missing or not PENDING', async () => {
    dbMocks.getInboundMessage.mockResolvedValue(null)
    const identity = new InMemoryIdentityService()
    const memory = new InMemoryMemoryService()
    await processInboundJob(noopPool, identity, memory, 'missing')
    expect(dbMocks.setInboundStatus).not.toHaveBeenCalled()
    expect(dbMocks.insertOutboundDraft).not.toHaveBeenCalled()

    dbMocks.getInboundMessage.mockResolvedValue(baseInboundRow({ status: 'DONE' }))
    await processInboundJob(noopPool, identity, memory, 'in-1')
    expect(dbMocks.setInboundStatus).not.toHaveBeenCalled()
  })
})
