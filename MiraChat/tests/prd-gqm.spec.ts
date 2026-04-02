/**
 * Executable traceability for PRD-MiraForU.md + product-GQM-MiraForU.md.
 * See docs/prd-gqm-e2e-test-suite.md for the full mapping table.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { MessageEvent, OutboundCommand } from '@delegate-ai/adapter-types'
import {
  DelegateRuntime,
  buildContextBundle,
  classifyIntent,
  createInMemoryRuntime,
  fallbackReplyOptions,
  fallbackThreadSummary,
  runCognitivePipeline,
} from '@delegate-ai/agent-core'
import { InMemoryApprovalStore } from '@delegate-ai/approval'
import { AssistService } from '@delegate-ai/assist-core'
import { AdapterRegistry } from '@delegate-ai/adapter-types'
import { DefaultPolicyEngine } from '@delegate-ai/policy-engine'
import { InMemoryIdentityService } from '@delegate-ai/identity'
import { InMemoryMemoryService } from '@delegate-ai/memory'

const baseEvent = (overrides: Partial<MessageEvent> = {}): MessageEvent => ({
  channel: 'whatsapp',
  accountId: 'acc-1',
  userId: 'user-1',
  senderId: 'contact-1',
  threadId: 'thread-1',
  messageId: `m-${Date.now()}`,
  text: 'Hello there',
  timestamp: Date.now(),
  threadType: 'dm',
  ...overrides,
})

describe('PRD §4 / §5 — pipeline & policy (G1, G4)', () => {
  const policy = new DefaultPolicyEngine()

  it('blocks drafts that imply financial commitment (hard boundary)', async () => {
    const decision = await policy.evaluate({
      event: baseEvent(),
      relationship: {
        userId: 'u',
        contactId: 'c',
        role: 'vendor',
        tone: 'neutral',
        riskLevel: 'low',
        notes: [],
      },
      draft: {
        id: 'd1',
        mode: 'approve',
        response: 'I will wire transfer the invoice tomorrow.',
        confidence: 0.99,
        reasons: [],
        memoryRefs: [],
        createdAt: Date.now(),
      },
    })
    expect(decision.action).toBe('BLOCK')
    expect(decision.reasons[0]).toBe('financial_commitment_or_hard_boundary')
  })

  it('forces REVIEW when confidence is low (G1 / low_confidence)', async () => {
    const decision = await policy.evaluate({
      event: baseEvent(),
      relationship: {
        userId: 'u',
        contactId: 'c',
        role: 'peer',
        tone: 'warm',
        riskLevel: 'low',
        notes: [],
      },
      draft: {
        id: 'd1',
        mode: 'approve',
        response: 'Sounds good.',
        confidence: 0.5,
        reasons: [],
        memoryRefs: [],
        createdAt: Date.now(),
      },
    })
    expect(decision.action).toBe('REVIEW')
    expect(decision.reasons).toContain('low_confidence')
  })

  it('MVP default is human approval without MIRACHAT_ALLOW_AUTO_SEND (PRD v1)', async () => {
    const prev = process.env.MIRACHAT_ALLOW_AUTO_SEND
    delete process.env.MIRACHAT_ALLOW_AUTO_SEND
    const decision = await policy.evaluate({
      event: baseEvent({ channel: 'whatsapp', threadType: 'dm' }),
      relationship: {
        userId: 'u',
        contactId: 'c',
        role: 'peer',
        tone: 'warm',
        riskLevel: 'low',
        notes: [],
      },
      draft: {
        id: 'd1',
        mode: 'approve',
        response: 'Thanks — I will follow up shortly.',
        confidence: 0.95,
        reasons: [],
        memoryRefs: [],
        createdAt: Date.now(),
      },
    })
    if (prev !== undefined) {
      process.env.MIRACHAT_ALLOW_AUTO_SEND = prev
    }
    expect(decision.action).toBe('REVIEW')
    expect(decision.reasons).toContain('mvp_default_human_approval')
  })

  it('allows AUTO_SEND only when MIRACHAT_ALLOW_AUTO_SEND=true and DM is low-risk (v2 gate)', async () => {
    process.env.MIRACHAT_ALLOW_AUTO_SEND = 'true'
    const decision = await policy.evaluate({
      event: baseEvent({ channel: 'whatsapp', threadType: 'dm' }),
      relationship: {
        userId: 'u',
        contactId: 'c',
        role: 'peer',
        tone: 'warm',
        riskLevel: 'low',
        notes: [],
      },
      draft: {
        id: 'd1',
        mode: 'approve',
        response: 'Thanks — I will follow up shortly.',
        confidence: 0.95,
        reasons: [],
        memoryRefs: [],
        createdAt: Date.now(),
      },
    })
    delete process.env.MIRACHAT_ALLOW_AUTO_SEND
    expect(decision.action).toBe('AUTO_SEND')
  })

  it('forces REVIEW for high-risk relationship (G1 / G3)', async () => {
    const decision = await policy.evaluate({
      event: baseEvent(),
      relationship: {
        userId: 'u',
        contactId: 'c',
        role: 'board',
        tone: 'formal',
        riskLevel: 'high',
        notes: [],
      },
      draft: {
        id: 'd1',
        mode: 'approve',
        response: 'Noted.',
        confidence: 0.95,
        reasons: [],
        memoryRefs: [],
        createdAt: Date.now(),
      },
    })
    expect(decision.action).toBe('REVIEW')
    expect(decision.reasons).toContain('high_risk_relationship')
  })

  it('forces REVIEW for group threads in MVP (G1)', async () => {
    const decision = await policy.evaluate({
      event: baseEvent({ threadType: 'group' }),
      relationship: {
        userId: 'u',
        contactId: 'c',
        role: 'peer',
        tone: 'warm',
        riskLevel: 'low',
        notes: [],
      },
      draft: {
        id: 'd1',
        mode: 'approve',
        response: 'Thanks everyone.',
        confidence: 0.95,
        reasons: [],
        memoryRefs: [],
        createdAt: Date.now(),
      },
    })
    expect(decision.action).toBe('REVIEW')
    expect(decision.reasons).toContain('group_thread_mvp')
  })

  it('forces REVIEW for Twilio channels by default (compliance / G1)', async () => {
    const prevAllow = process.env.MIRACHAT_ALLOW_AUTO_SEND
    const prevTwilio = process.env.MIRACHAT_TWILIO_AUTO_SEND
    delete process.env.MIRACHAT_ALLOW_AUTO_SEND
    delete process.env.MIRACHAT_TWILIO_AUTO_SEND
    try {
      for (const channel of ['twilio_sms', 'twilio_whatsapp'] as const) {
        const decision = await policy.evaluate({
          event: baseEvent({ channel, threadType: 'dm' }),
          relationship: {
            userId: 'u',
            contactId: 'c',
            role: 'peer',
            tone: 'warm',
            riskLevel: 'low',
            notes: [],
          },
          draft: {
            id: 'd1',
            mode: 'approve',
            response: 'OK.',
            confidence: 0.95,
            reasons: [],
            memoryRefs: [],
            createdAt: Date.now(),
          },
        })
        expect(decision.action).toBe('REVIEW')
        expect(decision.reasons).toContain('twilio_compliance_default')
      }
    } finally {
      if (prevAllow !== undefined) {
        process.env.MIRACHAT_ALLOW_AUTO_SEND = prevAllow
      }
      if (prevTwilio !== undefined) {
        process.env.MIRACHAT_TWILIO_AUTO_SEND = prevTwilio
      }
    }
  })

  it('allows AUTO_SEND on Twilio when MIRACHAT_ALLOW_AUTO_SEND and MIRACHAT_TWILIO_AUTO_SEND (v2)', async () => {
    process.env.MIRACHAT_ALLOW_AUTO_SEND = 'true'
    process.env.MIRACHAT_TWILIO_AUTO_SEND = 'true'
    try {
      for (const channel of ['twilio_sms', 'twilio_whatsapp'] as const) {
        const decision = await policy.evaluate({
          event: baseEvent({ channel, threadType: 'dm' }),
          relationship: {
            userId: 'u',
            contactId: 'c',
            role: 'peer',
            tone: 'warm',
            riskLevel: 'low',
            notes: [],
          },
          draft: {
            id: 'd1',
            mode: 'approve',
            response: 'Thanks — will follow up shortly.',
            confidence: 0.95,
            reasons: [],
            memoryRefs: [],
            createdAt: Date.now(),
          },
        })
        expect(decision.action).toBe('AUTO_SEND')
        expect(decision.reasons).toContain('auto_send_twilio_v2_env_low_risk_dm')
      }
    } finally {
      delete process.env.MIRACHAT_ALLOW_AUTO_SEND
      delete process.env.MIRACHAT_TWILIO_AUTO_SEND
    }
  })
})

describe('PRD §4 — context engine & intent (G2, G3)', () => {
  it('classifyIntent tags scheduling domain', () => {
    const intent = classifyIntent(baseEvent({ text: 'Can we meet Thursday afternoon?' }))
    expect(intent.domain).toBe('scheduling')
  })

  it('classifyIntent tags finance and delivery domains', () => {
    expect(classifyIntent(baseEvent({ text: 'Please send the invoice and payment link.' })).domain).toBe('finance')
    expect(classifyIntent(baseEvent({ text: 'We must ship the milestone by Friday.' })).domain).toBe('delivery')
  })

  it('classifyIntent elevates urgency from keywords', () => {
    expect(classifyIntent(baseEvent({ text: 'This is urgent — need an answer ASAP.' })).urgency).toBe('high')
  })

  it('buildContextBundle aggregates identity, relationship, memory', async () => {
    const identity = new InMemoryIdentityService()
    const memory = new InMemoryMemoryService()
    const event = baseEvent({ text: 'follow up on the deck' })
    await memory.recordIncoming(event)
    const ctx = await buildContextBundle({ identityService: identity, memoryService: memory }, event)
    expect(ctx.identity.userId).toBe('user-1')
    expect(ctx.relationship.contactId).toBe('contact-1')
    expect(ctx.memory.recentMessages.length).toBeGreaterThanOrEqual(1)
  })

  it('runCognitivePipeline produces a draft with memory refs', async () => {
    const identity = new InMemoryIdentityService()
    const memory = new InMemoryMemoryService()
    const event = baseEvent({ text: 'ping' })
    await memory.recordIncoming(event)
    const ctx = await buildContextBundle({ identityService: identity, memoryService: memory }, event)
    const draft = await runCognitivePipeline(ctx)
    expect(draft.response.length).toBeGreaterThan(0)
    expect(draft.mode).toBe('approve')
    expect(Array.isArray(draft.memoryRefs)).toBe(true)
    expect(draft.response).not.toMatch(/thread transcript/i)
  })

  it('memory search surfaces cross-thread matches (G3 cross-channel context)', async () => {
    const memory = new InMemoryMemoryService()
    await memory.recordIncoming(
      baseEvent({ threadId: 'other', messageId: 'x1', text: 'Project Phoenix budget discussion' }),
    )
    const hits = await memory.searchMessages('user-1', 'Phoenix budget')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]!.threadId).toBe('other')
  })

  it('cognitive draft incorporates identity hardBoundaries (G3 UserModel)', async () => {
    const identity = new InMemoryIdentityService()
    await identity.upsertIdentity({
      userId: 'user-1',
      displayName: 'Alex',
      tone: 'crisp',
      styleGuide: [],
      hardBoundaries: ['no financial commitments', 'no legal commitments'],
    })
    const memory = new InMemoryMemoryService()
    const ctx = await buildContextBundle(
      { identityService: identity, memoryService: memory },
      baseEvent({ text: 'Can you confirm we will pay the invoice today?' }),
    )
    const draft = await runCognitivePipeline(ctx)
    expect(draft.response).toMatch(/no financial commitments/i)
  })
})

describe('PRD §4 — multi-option replies & thread summary (MVP)', () => {
  it('fallbackReplyOptions returns three distinct variants', () => {
    const opts = fallbackReplyOptions('Please review the doc by EOD.')
    expect(opts).toHaveLength(3)
    expect(opts.map(o => o.label).sort()).toEqual(['assertive', 'concise', 'warm'].sort())
  })

  it('fallbackThreadSummary handles empty transcript', () => {
    expect(fallbackThreadSummary('')).toMatch(/no prior/i)
  })
})

describe('AssistService variants', () => {
  it('returns usable variants instead of placeholder option text', async () => {
    const service = new AssistService()
    const suggestions = await service.suggestReplies({
      request: {
        userId: 'user-1',
        prompt: 'Latest: Can we find time next week to review the deck?',
      },
      identity: {
        userId: 'user-1',
        displayName: 'Mira User',
        tone: 'warm, direct',
        styleGuide: ['be clear'],
        hardBoundaries: ['no financial commitments'],
      },
      relationship: {
        userId: 'user-1',
        contactId: 'contact-1',
        role: 'investor',
        tone: 'warm',
        riskLevel: 'medium',
        notes: [],
      },
    })

    expect(suggestions).toHaveLength(3)
    for (const suggestion of suggestions) {
      expect(suggestion.response).not.toMatch(/Option \d/i)
      expect(suggestion.response.length).toBeGreaterThan(20)
    }
  })
})

describe('PRD §8 — DelegateRuntime flows (G1)', () => {
  beforeEach(() => {
    delete process.env.MIRACHAT_ALLOW_AUTO_SEND
  })

  afterEach(() => {
    delete process.env.MIRACHAT_ALLOW_AUTO_SEND
  })

  it('does not create approval or send when policy BLOCKs', async () => {
    const sent: OutboundCommand[] = []
    const registry = new AdapterRegistry()
    registry.register({
      channel: 'whatsapp',
      async send(cmd) {
        sent.push(cmd)
      },
    })
    const blockPolicy = {
      evaluate: async () =>
        ({
          action: 'BLOCK' as const,
          reasons: ['test_block'],
        }) as const,
    }
    const rt = new DelegateRuntime({
      identityService: new InMemoryIdentityService(),
      memoryService: new InMemoryMemoryService(),
      approvalStore: new InMemoryApprovalStore(),
      policyEngine: blockPolicy,
      adapterRegistry: registry,
      assistService: new AssistService(),
    })
    const out = await rt.handleMessage(baseEvent({ text: 'noop' }))
    expect(out.decision.action).toBe('BLOCK')
    expect(out.approval).toBeUndefined()
    expect(sent).toHaveLength(0)
  })

  it('queues approval on REVIEW (no auto-send without env flag)', async () => {
    const runtime = createInMemoryRuntime()
    const sent: OutboundCommand[] = []
    runtime.registerAdapter({
      channel: 'whatsapp',
      async send(cmd) {
        sent.push(cmd)
      },
    })
    const out = await runtime.handleMessage(
      baseEvent({ text: 'Can you send the notes?' }),
    )
    expect(out.decision.action).toBe('REVIEW')
    expect(out.approval).toBeDefined()
    expect(sent).toHaveLength(0)
  })

  it('Assist path returns three suggestion drafts (PRD multi-option / G2)', async () => {
    const runtime = createInMemoryRuntime()
    const suggestions = await runtime.handleAssistRequest({
      userId: 'user-1',
      prompt: 'Decline politely.',
    })
    expect(suggestions).toHaveLength(3)
    expect(suggestions.every(s => s.mode === 'assist')).toBe(true)
  })

  it('AUTO_SEND path sends via adapter when MIRACHAT_ALLOW_AUTO_SEND (G4 bounded auto)', async () => {
    process.env.MIRACHAT_ALLOW_AUTO_SEND = 'true'
    const identity = new InMemoryIdentityService()
    await identity.upsertRelationship({
      userId: 'user-1',
      contactId: 'contact-1',
      role: 'peer',
      tone: 'warm',
      riskLevel: 'low',
      notes: [],
    })
    const runtime = new DelegateRuntime({
      identityService: identity,
      memoryService: new InMemoryMemoryService(),
      approvalStore: new InMemoryApprovalStore(),
      policyEngine: new DefaultPolicyEngine(),
      adapterRegistry: new AdapterRegistry(),
      assistService: new AssistService(),
    })
    const sent: OutboundCommand[] = []
    runtime.registerAdapter({
      channel: 'whatsapp',
      async send(cmd) {
        sent.push(cmd)
      },
    })
    const out = await runtime.handleMessage(baseEvent({ text: 'Thanks!' }))
    delete process.env.MIRACHAT_ALLOW_AUTO_SEND
    expect(out.decision.action).toBe('AUTO_SEND')
    expect(sent).toHaveLength(1)
    expect(sent[0]!.threadId).toBe('thread-1')
  })
})

describe('Approval queue (GQM trust / approve path)', () => {
  it('approve and reject update approval record status', async () => {
    const runtime = createInMemoryRuntime()
    const out = await runtime.handleMessage(baseEvent({ text: 'Hi' }))
    const id = out.approval!.id
    const approved = await runtime.approvalStore.approve(id)
    expect(approved?.status).toBe('approved')

    const out2 = await runtime.handleMessage(baseEvent({ text: 'Again', messageId: 'm2' }))
    const rejected = await runtime.approvalStore.reject(out2.approval!.id)
    expect(rejected?.status).toBe('rejected')
  })

  it('edit path stores editedText (GQM edits-per-draft signal)', async () => {
    const runtime = createInMemoryRuntime()
    const out = await runtime.handleMessage(baseEvent({ text: 'Hi' }))
    const edited = await runtime.approvalStore.edit(out.approval!.id, 'Revised copy.')
    expect(edited?.status).toBe('edited')
    expect(edited?.editedText).toBe('Revised copy.')
  })
})
