import {
  type InboundJobData,
  MIRACHAT_INBOUND_QUEUE,
  DelegationEventType,
  POLICY_ENGINE_ID,
  getInboundMessage,
  insertDelegationEvent,
  insertOutboundDraft,
  rejectSupersededDraftsForThread,
  setInboundStatus,
} from '@delegate-ai/db'
import {
  buildContextBundle,
  buildReplyOptions,
  buildThreadSummary,
  classifyIntent,
  runCognitivePipeline,
} from '@delegate-ai/agent-core'
import { DefaultPolicyEngine } from '@delegate-ai/policy-engine'
import type { IdentityService, MemoryService, MessageEvent } from '@delegate-ai/adapter-types'
import type PgBoss from 'pg-boss'
import type { Pool } from 'pg'

const policyEngine = new DefaultPolicyEngine()

const rowToMessageEvent = (row: {
  channel: string
  account_id: string
  user_id: string
  sender_id: string
  thread_id: string
  message_id: string | null
  id: string
  raw_text: string
  received_at: Date
  room_id: string | null
}): MessageEvent => ({
  channel: row.channel as MessageEvent['channel'],
  accountId: row.account_id,
  userId: row.user_id,
  senderId: row.sender_id,
  threadId: row.thread_id,
  messageId: row.message_id ?? row.id,
  text: row.raw_text,
  timestamp: row.received_at.getTime(),
  threadType: row.room_id ? 'group' : 'dm',
})

export const processInboundJob = async (
  pool: Pool,
  identity: IdentityService,
  memory: MemoryService,
  inboundMessageId: string,
): Promise<void> => {
  const row = await getInboundMessage(pool, inboundMessageId)
  if (!row) {
    return
  }
  if (row.status !== 'PENDING' && row.status !== 'PROCESSING') {
    return
  }
  await setInboundStatus(pool, inboundMessageId, 'PROCESSING')
  try {
    const event = rowToMessageEvent(row)
    const intent = classifyIntent(event)
    const context = await buildContextBundle({ identityService: identity, memoryService: memory }, event)
    const draft = await runCognitivePipeline(context)
    const decision = await policyEngine.evaluate({
      event,
      draft,
      relationship: context.relationship,
    })
    void insertDelegationEvent(pool, {
      eventType: DelegationEventType.PolicyEvaluated,
      userId: row.user_id,
      channel: row.channel,
      accountId: row.account_id,
      threadId: row.thread_id,
      policyAction: decision.action,
      confidence: draft.confidence,
      policyRuleId: POLICY_ENGINE_ID,
      inboundMessageId,
      metadata: {
        policy_reasons: decision.reasons,
        intent_domain: intent.domain,
        intent_urgency: intent.urgency,
      },
    }).catch(err => console.error('[measurement] policy.evaluated', err))

    const transcript = context.memory.recentMessages.map(m => `${m.direction}: ${m.content}`).join('\n')

    let outboundStatus: 'DRAFTED' | 'APPROVED' | 'REJECTED'
    let replyOptions: { label: string; text: string }[] | null = null
    let threadSummary: string
    let approvedAt: Date | null = null

    if (decision.action === 'BLOCK') {
      outboundStatus = 'REJECTED'
      threadSummary = `Policy blocked: ${decision.reasons.join(' | ')}`
    } else if (decision.action === 'AUTO_SEND') {
      outboundStatus = 'APPROVED'
      approvedAt = new Date()
      threadSummary = await buildThreadSummary(transcript)
    } else {
      outboundStatus = 'DRAFTED'
      const [opts, sum] = await Promise.all([
        buildReplyOptions(context, draft.response),
        buildThreadSummary(transcript),
      ])
      replyOptions = opts.map(o => ({ label: o.label, text: o.text }))
      threadSummary = sum
    }

    const insertedDraft = await insertOutboundDraft(pool, {
      inboundMessageId,
      generatedText: draft.response,
      confidenceScore: draft.confidence,
      status: outboundStatus,
      ruleTriggered: decision.reasons.join(' | ') || null,
      channel: row.channel,
      accountId: row.account_id,
      userId: row.user_id,
      threadId: row.thread_id,
      intentSummary: intent.summary,
      replyOptions,
      threadSummary,
      approvedAt,
    })

    const superseded = await rejectSupersededDraftsForThread(pool, {
      keepDraftId: insertedDraft.id,
      channel: insertedDraft.channel,
      accountId: insertedDraft.account_id,
      userId: insertedDraft.user_id,
      threadId: insertedDraft.thread_id,
      createdAt: insertedDraft.created_at,
    })
    for (const staleDraft of superseded) {
      void insertDelegationEvent(pool, {
        eventType: DelegationEventType.DraftRejected,
        userId: staleDraft.user_id,
        channel: staleDraft.channel,
        accountId: staleDraft.account_id,
        threadId: staleDraft.thread_id,
        draftId: staleDraft.id,
        inboundMessageId: staleDraft.inbound_message_id,
        metadata: {
          reason: 'superseded_by_newer_draft',
          superseded_by_draft_id: insertedDraft.id,
          superseding_status: outboundStatus,
          superseding_policy_action: decision.action,
        },
      }).catch(err => console.error('[measurement] draft.rejected superseded', err))
    }

    void insertDelegationEvent(pool, {
      eventType: DelegationEventType.DraftCreated,
      userId: row.user_id,
      channel: row.channel,
      accountId: row.account_id,
      threadId: row.thread_id,
      policyAction: decision.action,
      confidence: draft.confidence,
      policyRuleId: POLICY_ENGINE_ID,
      draftId: insertedDraft.id,
      inboundMessageId,
      metadata: {
        intent_summary: intent.summary,
        intent_domain: intent.domain,
        outbound_status: outboundStatus,
        source:
          decision.action === 'AUTO_SEND'
            ? 'policy_auto_send'
            : decision.action === 'BLOCK'
              ? 'policy_block'
              : 'review_queue',
        reply_option_count: replyOptions?.length ?? 0,
      },
    }).catch(err => console.error('[measurement] draft.created', err))

    if (decision.action === 'AUTO_SEND') {
      void insertDelegationEvent(pool, {
        eventType: DelegationEventType.DraftAutoQueued,
        userId: insertedDraft.user_id,
        channel: insertedDraft.channel,
        accountId: insertedDraft.account_id,
        threadId: insertedDraft.thread_id,
        draftId: insertedDraft.id,
        inboundMessageId: insertedDraft.inbound_message_id,
        metadata: {
          policy_reasons: decision.reasons,
        },
      }).catch(err => console.error('[measurement] draft.auto_queued', err))
    }

    if (decision.action === 'BLOCK') {
      void insertDelegationEvent(pool, {
        eventType: DelegationEventType.DraftRejected,
        userId: insertedDraft.user_id,
        channel: insertedDraft.channel,
        accountId: insertedDraft.account_id,
        threadId: insertedDraft.thread_id,
        draftId: insertedDraft.id,
        inboundMessageId: insertedDraft.inbound_message_id,
        metadata: {
          reason: 'policy_block',
          policy_reasons: decision.reasons,
        },
      }).catch(err => console.error('[measurement] draft.rejected blocked', err))
    }

    await setInboundStatus(pool, inboundMessageId, 'DONE')
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    void insertDelegationEvent(pool, {
      eventType: DelegationEventType.PipelineFailed,
      userId: row.user_id,
      channel: row.channel,
      accountId: row.account_id,
      threadId: row.thread_id,
      inboundMessageId,
      metadata: { error: message },
    }).catch(err => console.error('[measurement] pipeline.failed', err))
    await setInboundStatus(pool, inboundMessageId, 'FAILED', message)
  }
}

export const registerMirachatWorkers = async (
  boss: PgBoss,
  pool: Pool,
  identity: IdentityService,
  memory: MemoryService,
): Promise<void> => {
  await boss.work(MIRACHAT_INBOUND_QUEUE, async jobs => {
    for (const job of jobs) {
      const data = job.data as InboundJobData
      if (!data?.inboundMessageId) {
        continue
      }
      await processInboundJob(pool, identity, memory, data.inboundMessageId)
    }
  })
}
