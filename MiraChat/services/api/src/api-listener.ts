import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Channel, IdentityProfile, MessageEvent, Mode, RelationshipProfile } from '@delegate-ai/adapter-types'
import type { DelegateRuntime } from '@delegate-ai/agent-core'
import {
  buildAssistSuggestions,
  buildContextBundle,
  buildReplyOptions,
  buildThreadSummary,
  classifyIntent,
  runCognitivePipeline,
} from '@delegate-ai/agent-core'
import { runNegotiationTurn, toolProposeSlots, validateA2aPayload } from '@delegate-ai/negotiation-tools'
import {
  appendOutboxEvent,
  approveAndMarkSentOutboundDraft,
  approveOutboundDraft,
  DelegationEventType,
  draftHasEventType,
  editApproveAndMarkSentOutboundDraft,
  editAndApproveOutboundDraft,
  enqueueInboundProcessing,
  getOutboundDraft,
  getUserConnection,
  insertA2aEnvelope,
  insertDelegationEvent,
  insertInboundMessage,
  listA2aEnvelopesForUser,
  listDelegationEvents,
  listDraftedOutboundTriage,
  listPendingSend,
  listThreadSummariesForUser,
  markOutboundSendFailed,
  markOutboundSent,
  queryGqmRollup,
  rejectOutboundDraft,
  respondA2aEnvelope,
  setRelationshipAutoReplyEnabled,
  selectReplyOptionApproveAndMarkSent,
  selectReplyOptionAndApprove,
  upsertUserConnection,
  upsertUserConnectionAuth,
  type PostgresIdentityService,
  type PostgresMemoryService,
} from '@delegate-ai/db'
import type { Pool } from 'pg'
import type PgBoss from 'pg-boss'
import { createOpenClawDoer, type OpenClawDoer } from '@delegate-ai/openclaw-doer'
import {
  googleAuthorizeUrl,
  googleOAuthCallback,
  ingestGmailIntoMemory,
  ingestSlackIntoMemory,
  slackAuthorizeUrl,
  slackOAuthCallback,
} from './oauth-ingest.js'
import {
  createMiniProgramSessionToken,
  exchangeMiniProgramCode,
  mapDraftToMiniProgramCard,
  verifyMiniProgramSessionToken,
} from './mini-program.js'

export interface MirachatSqlContext {
  pool: Pool
  boss: PgBoss
  mirachatIdentity: PostgresIdentityService
  mirachatMemory: PostgresMemoryService
}

export interface DelegateApiContext {
  memoryRuntime: DelegateRuntime
  mirachat: MirachatSqlContext | null
  /** After startup probe; omit in unit tests (treated as ready when mirachat is set). */
  mirachatWorkerReady?: boolean
  openClawDoer?: OpenClawDoer
}

export const readBody = async (request: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}

export const sendJson = (response: ServerResponse, statusCode: number, data: unknown) => {
  response.writeHead(statusCode, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,OPTIONS',
    'access-control-allow-headers': 'content-type',
  })
  response.end(JSON.stringify(data, null, 2))
}

export const parseJson = (raw: string): Record<string, unknown> => {
  try {
    return JSON.parse(raw || '{}') as Record<string, unknown>
  } catch {
    return {}
  }
}

const stringList = (value: unknown): string[] | null => {
  if (value == null) {
    return []
  }
  if (!Array.isArray(value)) {
    return null
  }
  const next = value
    .map(item => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
  return next.length === value.length ? next : null
}

const isRelationshipPriority = (
  value: unknown,
): value is 'critical' | 'high' | 'normal' | 'defer' =>
  value === 'critical' || value === 'high' || value === 'normal' || value === 'defer'

const isPreference = (value: unknown): value is 'morning' | 'afternoon' | 'flex' =>
  value === 'morning' || value === 'afternoon' || value === 'flex'

const isMode = (value: unknown): value is Mode =>
  value === 'assist' || value === 'approve' || value === 'auto'

type OpenClawDoerRequest = {
  provider: 'openclaw'
  task?: string
  agentId?: string
  sessionId?: string
  to?: string
  thinking?: string
  timeoutSeconds?: number
  deliver?: boolean
  channel?: string
  replyTo?: string
  replyChannel?: string
  replyAccount?: string
}

const trimString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

const resolveMiniProgramSecret = (): string =>
  process.env.MINI_PROGRAM_SESSION_SECRET?.trim() || 'dev-mini-program-secret'

const readMiniProgramSessionToken = (request: IncomingMessage): string | undefined => {
  const auth = request.headers.authorization
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    const token = auth.slice('Bearer '.length).trim()
    return token || undefined
  }
  return undefined
}

const finitePositiveTimeoutSeconds = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined
  }
  return Math.floor(value)
}

const parseOpenClawDoerRequest = (
  body: Record<string, unknown>,
  fallbackTask: string,
): OpenClawDoerRequest | null => {
  if (!Object.prototype.hasOwnProperty.call(body, 'doer')) {
    return null
  }
  const raw = body.doer
  if (raw === undefined || raw === null) {
    return null
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('doer must be a plain object')
  }
  const provider = trimString((raw as Record<string, unknown>).provider)
  if (provider !== 'openclaw') {
    throw new Error('doer.provider must be "openclaw"')
  }
  const explicitTask = trimString((raw as Record<string, unknown>).task)
  const trimmedFallback = fallbackTask.trim()
  const task = explicitTask ?? (trimmedFallback || undefined)
  if (!task) {
    throw new Error(
      'OpenClaw doer requires a non-empty task (set doer.task or ensure draft text / edited text / option text)',
    )
  }
  return {
    provider,
    task,
    agentId: trimString((raw as Record<string, unknown>).agentId),
    sessionId: trimString((raw as Record<string, unknown>).sessionId),
    to: trimString((raw as Record<string, unknown>).to),
    thinking: trimString((raw as Record<string, unknown>).thinking),
    timeoutSeconds: finitePositiveTimeoutSeconds((raw as Record<string, unknown>).timeoutSeconds),
    deliver: (raw as Record<string, unknown>).deliver === true,
    channel: trimString((raw as Record<string, unknown>).channel),
    replyTo: trimString((raw as Record<string, unknown>).replyTo),
    replyChannel: trimString((raw as Record<string, unknown>).replyChannel),
    replyAccount: trimString((raw as Record<string, unknown>).replyAccount),
  }
}

const runOpenClawDoerForDraft = async (
  pool: Pool,
  doer: OpenClawDoer,
  params: {
    request: OpenClawDoerRequest
    draftId: string
    userId: string
    channel: string
    accountId: string
    threadId: string
    inboundMessageId: string | null
  },
) => {
  await insertDelegationEvent(pool, {
    eventType: DelegationEventType.DoerStarted,
    userId: params.userId,
    channel: params.channel,
    accountId: params.accountId,
    threadId: params.threadId,
    draftId: params.draftId,
    inboundMessageId: params.inboundMessageId,
    metadata: {
      provider: params.request.provider,
      agentId: params.request.agentId ?? null,
      sessionId: params.request.sessionId ?? null,
      to: params.request.to ?? null,
    },
  })

  try {
    const result = await doer.run({
      task: params.request.task ?? '',
      agentId: params.request.agentId,
      sessionId: params.request.sessionId,
      to: params.request.to,
      thinking: params.request.thinking,
      timeoutSeconds: params.request.timeoutSeconds,
      deliver: params.request.deliver,
      channel: params.request.channel,
      replyTo: params.request.replyTo,
      replyChannel: params.request.replyChannel,
      replyAccount: params.request.replyAccount,
    })
    await insertDelegationEvent(pool, {
      eventType: DelegationEventType.DoerCompleted,
      userId: params.userId,
      channel: params.channel,
      accountId: params.accountId,
      threadId: params.threadId,
      draftId: params.draftId,
      inboundMessageId: params.inboundMessageId,
      metadata: {
        provider: params.request.provider,
        summary: result.summary,
        selector: result.selector,
      },
    })
    return result
  } catch (error) {
    await insertDelegationEvent(pool, {
      eventType: DelegationEventType.DoerFailed,
      userId: params.userId,
      channel: params.channel,
      accountId: params.accountId,
      threadId: params.threadId,
      draftId: params.draftId,
      inboundMessageId: params.inboundMessageId,
      metadata: {
        provider: params.request.provider,
        error: error instanceof Error ? error.message : String(error),
      },
    })
    throw error
  }
}

export const createDelegateApiListener = (ctx: DelegateApiContext) => {
  const getOpenClawDoer = (): OpenClawDoer => ctx.openClawDoer ?? createOpenClawDoer()

  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    try {
      if (request.method === 'OPTIONS') {
        response.writeHead(204, {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET,POST,PUT,PATCH,OPTIONS',
          'access-control-allow-headers': 'content-type',
        })
        response.end()
        return
      }

      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)

      if (request.method === 'GET' && url.pathname === '/health') {
        sendJson(response, 200, {
          ok: true,
          service: 'delegate-ai-api',
          mirachat: Boolean(ctx.mirachat),
        })
        return
      }

      if (request.method === 'GET' && url.pathname === '/health/mirachat-worker') {
        if (!ctx.mirachat) {
          sendJson(response, 200, { ok: true, mirachat: false })
          return
        }
        const workerReady = ctx.mirachatWorkerReady !== false
        if (!workerReady) {
          sendJson(response, 503, {
            ok: false,
            mirachat: true,
            workerReady: false,
            error: 'mirachat_worker_not_ready',
          })
          return
        }
        sendJson(response, 200, {
          ok: true,
          mirachat: true,
          workerReady: true,
        })
        return
      }

    if (request.method === 'GET' && url.pathname === '/approvals') {
      sendJson(response, 200, await ctx.memoryRuntime.approvalStore.listApprovals())
      return
    }

    if (request.method === 'POST' && url.pathname === '/assist') {
      const body = parseJson(await readBody(request))
      const suggestions = await ctx.memoryRuntime.handleAssistRequest({
        userId: String(body.userId ?? 'demo-user'),
        prompt: String(body.prompt ?? 'Help me reply clearly and politely.'),
      })
      sendJson(response, 200, suggestions)
      return
    }

    if (request.method === 'POST' && url.pathname === '/simulate-message') {
      const body = parseJson(await readBody(request))
      const result = await ctx.memoryRuntime.handleMessage({
        channel: (body.channel as Channel) ?? 'whatsapp',
        accountId: String(body.accountId ?? 'demo-account'),
        userId: String(body.userId ?? 'demo-user'),
        senderId: String(body.senderId ?? 'demo-contact'),
        threadId: String(body.threadId ?? 'demo-thread'),
        messageId: String(body.messageId ?? `sim-${Date.now()}`),
        text: String(body.text ?? 'Can you follow up on this tomorrow?'),
        timestamp: Date.now(),
        threadType: (body.threadType as 'dm' | 'group') ?? 'dm',
      })
      sendJson(response, 200, result)
      return
    }

    if (request.method === 'POST' && url.pathname.startsWith('/approvals/')) {
      const [, , approvalId, action] = url.pathname.split('/')
      const body = parseJson(await readBody(request))

      if (action === 'approve') {
        sendJson(response, 200, await ctx.memoryRuntime.approvalStore.approve(approvalId))
        return
      }
      if (action === 'reject') {
        sendJson(response, 200, await ctx.memoryRuntime.approvalStore.reject(approvalId))
        return
      }
      if (action === 'edit') {
        sendJson(response, 200, await ctx.memoryRuntime.approvalStore.edit(approvalId, String(body.editedText ?? '')))
        return
      }
    }

    if (request.method === 'GET' && url.pathname === '/oauth/google/start') {
      const userId = url.searchParams.get('userId') ?? 'demo-user'
      const r = googleAuthorizeUrl(userId)
      if ('error' in r) {
        sendJson(response, 400, { error: r.error })
        return
      }
      response.writeHead(302, { Location: r.url })
      response.end()
      return
    }

    if (request.method === 'GET' && url.pathname === '/oauth/slack/start') {
      const userId = url.searchParams.get('userId') ?? 'demo-user'
      const r = slackAuthorizeUrl(userId)
      if ('error' in r) {
        sendJson(response, 400, { error: r.error })
        return
      }
      response.writeHead(302, { Location: r.url })
      response.end()
      return
    }

    if (request.method === 'POST' && url.pathname === '/mini-program/login') {
      const body = parseJson(await readBody(request))
      const code = trimString(body.code)
      if (!code) {
        sendJson(response, 400, { error: 'code required' })
        return
      }

      const exchanged = await exchangeMiniProgramCode({
        appId: process.env.MINI_PROGRAM_APP_ID ?? '',
        appSecret: process.env.MINI_PROGRAM_APP_SECRET ?? '',
        code,
      })
      if ('error' in exchanged) {
        sendJson(response, 400, exchanged)
        return
      }

      const userId = trimString(body.userId) ?? trimString(body.bindUserId) ?? 'demo-user'
      const expiresInSeconds = Number(process.env.MINI_PROGRAM_SESSION_TTL_SECONDS ?? 60 * 60 * 12)
      const sessionToken = createMiniProgramSessionToken(resolveMiniProgramSecret(), {
        openId: exchanged.openId,
        unionId: exchanged.unionId,
        userId,
        exp: Date.now() + expiresInSeconds * 1000,
      })

      sendJson(response, 200, {
        ok: true,
        openId: exchanged.openId,
        unionId: exchanged.unionId,
        sessionToken,
        expiresInSeconds,
        userId,
      })
      return
    }

    const { mirachat } = ctx
    if (!mirachat) {
      sendJson(response, 404, { error: 'Not found' })
      return
    }

    const { pool, boss, mirachatIdentity, mirachatMemory } = mirachat
    const miniProgramSessionToken =
      readMiniProgramSessionToken(request) ?? trimString(url.searchParams.get('sessionToken'))
    const miniProgramSession =
      miniProgramSessionToken != null
        ? verifyMiniProgramSessionToken(resolveMiniProgramSecret(), miniProgramSessionToken)
        : null
    const miniProgramUserId = miniProgramSession?.userId ?? trimString(url.searchParams.get('userId')) ?? 'demo-user'
    const requireMiniProgramSession = (): boolean => {
      if (!miniProgramSession) {
        sendJson(response, 401, { error: 'valid mini program session required' })
        return false
      }
      return true
    }

    if (request.method === 'GET' && url.pathname === '/mini-program/bootstrap') {
      if (!requireMiniProgramSession()) {
        return
      }
      const drafts = await listDraftedOutboundTriage(pool, 30)
      const threads = await listThreadSummariesForUser(pool, miniProgramUserId, 20)
      const channel = trimString(url.searchParams.get('channel'))
      const accountId = trimString(url.searchParams.get('accountId'))
      const connection = channel && accountId ? await getUserConnection(pool, channel, accountId) : null

      sendJson(response, 200, {
        ok: true,
        session:
          miniProgramSession == null
            ? null
            : {
                openId: miniProgramSession.openId,
                unionId: miniProgramSession.unionId,
                userId: miniProgramSession.userId,
                expiresAt: new Date(miniProgramSession.exp).toISOString(),
              },
        drafts: drafts.map(mapDraftToMiniProgramCard),
        threads,
        connection,
      })
      return
    }

    if (request.method === 'POST' && url.pathname === '/mini-program/assist') {
      if (!requireMiniProgramSession()) {
        return
      }
      const body = parseJson(await readBody(request))
      const event: MessageEvent = {
        channel: String(body.channel ?? 'wechat') as Channel,
        accountId: String(body.accountId ?? 'mini-program'),
        userId: miniProgramSession?.userId ?? String(body.userId ?? 'demo-user'),
        senderId: String(body.senderId ?? body.threadId ?? 'mini-program-user'),
        threadId: String(body.threadId ?? 'mini-program-thread'),
        messageId: String(body.messageId ?? `mini-program-${Date.now()}`),
        text: String(body.text ?? body.prompt ?? ''),
        timestamp: Date.now(),
        threadType: (body.threadType as 'dm' | 'group') ?? 'dm',
      }
      const context = await buildContextBundle(
        { identityService: mirachatIdentity, memoryService: mirachatMemory },
        event,
      )
      const primaryDraft = await runCognitivePipeline(context)
      const [replyOptions, threadSummary] = await Promise.all([
        buildReplyOptions(context, primaryDraft.response),
        buildThreadSummary(
          context.memory.recentMessages.map(m => `${m.direction}: ${m.content}`).join('\n'),
        ),
      ])

      sendJson(response, 200, {
        ok: true,
        threadSummary,
        primaryDraft,
        replyOptions,
      })
      return
    }

    if (request.method === 'POST' && url.pathname.match(/^\/mini-program\/drafts\/[^/]+\/approve$/)) {
      if (!requireMiniProgramSession()) {
        return
      }
      const id = url.pathname.split('/')[3]!
      const row = await approveOutboundDraft(pool, id)
      if (row) {
        void insertDelegationEvent(pool, {
          eventType: DelegationEventType.DraftApprovedAsIs,
          userId: row.user_id,
          channel: row.channel,
          accountId: row.account_id,
          threadId: row.thread_id,
          draftId: row.id,
          inboundMessageId: row.inbound_message_id,
          metadata: { source: 'mini_program' },
        }).catch(err => console.error('[measurement] draft.approved_as_is (mini)', err))
      }
      sendJson(response, row ? 200 : 404, row ? { ok: true, draft: row } : { error: 'Draft not found or not triageable' })
      return
    }

    if (request.method === 'POST' && url.pathname.match(/^\/mini-program\/drafts\/[^/]+\/reject$/)) {
      if (!requireMiniProgramSession()) {
        return
      }
      const id = url.pathname.split('/')[3]!
      const row = await rejectOutboundDraft(pool, id)
      if (row) {
        void insertDelegationEvent(pool, {
          eventType: DelegationEventType.DraftRejected,
          userId: row.user_id,
          channel: row.channel,
          accountId: row.account_id,
          threadId: row.thread_id,
          draftId: row.id,
          inboundMessageId: row.inbound_message_id,
          metadata: { source: 'mini_program' },
        }).catch(err => console.error('[measurement] draft.rejected (mini)', err))
      }
      sendJson(response, row ? 200 : 404, row ? { ok: true, draft: row } : { error: 'Draft not found or not triageable' })
      return
    }

    if (request.method === 'POST' && url.pathname.match(/^\/mini-program\/drafts\/[^/]+\/edit$/)) {
      if (!requireMiniProgramSession()) {
        return
      }
      const id = url.pathname.split('/')[3]!
      const body = parseJson(await readBody(request))
      const row = await editAndApproveOutboundDraft(pool, id, String(body.editedText ?? ''))
      if (row) {
        void insertDelegationEvent(pool, {
          eventType: DelegationEventType.DraftApprovedWithEdit,
          userId: row.user_id,
          channel: row.channel,
          accountId: row.account_id,
          threadId: row.thread_id,
          draftId: row.id,
          inboundMessageId: row.inbound_message_id,
          metadata: { source: 'mini_program' },
        }).catch(err => console.error('[measurement] draft.approved_with_edit (mini)', err))
      }
      sendJson(response, row ? 200 : 404, row ? { ok: true, draft: row } : { error: 'Draft not found or not triageable' })
      return
    }

    if (request.method === 'POST' && url.pathname.match(/^\/mini-program\/drafts\/[^/]+\/select-option$/)) {
      if (!requireMiniProgramSession()) {
        return
      }
      const id = url.pathname.split('/')[3]!
      const body = parseJson(await readBody(request))
      const index = Number(body.index ?? body.optionIndex ?? -1)
      const row = await selectReplyOptionAndApprove(pool, id, index)
      if (row) {
        void insertDelegationEvent(pool, {
          eventType: DelegationEventType.DraftApprovedWithEdit,
          userId: row.user_id,
          channel: row.channel,
          accountId: row.account_id,
          threadId: row.thread_id,
          draftId: row.id,
          inboundMessageId: row.inbound_message_id,
          metadata: { source: 'mini_program', option_index: index },
        }).catch(err => console.error('[measurement] draft.approved_with_edit option (mini)', err))
      }
      sendJson(
        response,
        row ? 200 : 404,
        row ? { ok: true, draft: row } : { error: 'Draft not found, invalid option, or not triageable' },
      )
      return
    }

    if (request.method === 'POST' && url.pathname === '/mirachat/inbound') {
      const body = parseJson(await readBody(request))
      const channel = String(body.channel ?? 'wechat') as Channel
      const accountId = String(body.accountId ?? 'default-account')
      const userId = String(body.userId ?? 'demo-user')
      await upsertUserConnection(pool, { channel, accountId, userId, status: 'ONLINE' })
      const conn = await getUserConnection(pool, channel, accountId)
      const inboundId = await insertInboundMessage(pool, {
        userConnectionId: conn?.id ?? null,
        contactId: String(body.contactId ?? body.senderId ?? 'unknown'),
        roomId: body.roomId != null ? String(body.roomId) : null,
        threadId: String(body.threadId ?? body.contactId ?? 'unknown'),
        rawText: String(body.text ?? ''),
        channel,
        accountId,
        userId,
        senderId: String(body.senderId ?? 'unknown'),
        messageId: body.messageId != null ? String(body.messageId) : null,
      })
      await enqueueInboundProcessing(boss, inboundId)
      const threadIdIn = String(body.threadId ?? body.contactId ?? 'unknown')
      void insertDelegationEvent(pool, {
        eventType: DelegationEventType.InboundEnqueued,
        userId,
        channel,
        accountId,
        threadId: threadIdIn,
        inboundMessageId: inboundId,
        metadata: { contact_id: String(body.contactId ?? ''), message_id: body.messageId ?? null },
      }).catch(err => console.error('[measurement] inbound.enqueued', err))
      sendJson(response, 202, { ok: true, inboundMessageId: inboundId })
      return
    }

    if (request.method === 'POST' && url.pathname === '/mirachat/assist') {
      const body = parseJson(await readBody(request))
      const event: MessageEvent = {
        channel: String(body.channel ?? 'twilio_whatsapp') as Channel,
        accountId: String(body.accountId ?? 'default-account'),
        userId: String(body.userId ?? 'demo-user'),
        senderId: String(body.senderId ?? body.threadId ?? 'unknown'),
        threadId: String(body.threadId ?? 'unknown'),
        messageId: String(body.messageId ?? `assist-${Date.now()}`),
        text: String(body.text ?? body.prompt ?? ''),
        timestamp: Date.now(),
        threadType: (body.threadType as 'dm' | 'group') ?? 'dm',
      }
      const context = await buildContextBundle(
        { identityService: mirachatIdentity, memoryService: mirachatMemory },
        event,
      )
      const primaryDraft = await runCognitivePipeline(context)
      const intent = classifyIntent(event)
      const [replyOptions, assistVariants, threadSummary] = await Promise.all([
        buildReplyOptions(context, primaryDraft.response),
        buildAssistSuggestions(context),
        buildThreadSummary(
          context.memory.recentMessages.map(m => `${m.direction}: ${m.content}`).join('\n'),
        ),
      ])
      sendJson(response, 200, {
        threadSummary,
        primaryDraft,
        replyOptions,
        assistVariants,
        intent,
      })
      void insertDelegationEvent(pool, {
        eventType: DelegationEventType.AssistGenerated,
        userId: event.userId,
        channel: event.channel,
        accountId: event.accountId,
        threadId: event.threadId,
        confidence: primaryDraft.confidence,
        metadata: {
          intent_domain: intent.domain,
          intent_urgency: intent.urgency,
          option_count: replyOptions.length,
          assist_variant_count: assistVariants.length,
        },
      }).catch(() => {})
      return
    }

    if (request.method === 'POST' && url.pathname === '/mirachat/summarize-thread') {
      const body = parseJson(await readBody(request))
      const threadId = String(body.threadId ?? '')
      const userId = String(body.userId ?? 'demo-user')
      if (!threadId) {
        sendJson(response, 400, { error: 'threadId required' })
        return
      }
      const recent = await mirachatMemory.getRecentMessages(threadId)
      const transcript = recent.map(m => `${m.direction}: ${m.content}`).join('\n')
      const summary = await buildThreadSummary(transcript)
      void insertDelegationEvent(pool, {
        eventType: DelegationEventType.SummaryGenerated,
        userId,
        threadId,
        metadata: { message_count: recent.length },
      }).catch(() => {})
      sendJson(response, 200, { threadId, userId, summary, messageCount: recent.length })
      return
    }

    if (request.method === 'GET' && url.pathname === '/oauth/google/callback') {
      const r = await googleOAuthCallback(pool, url.searchParams)
      if ('error' in r) {
        sendJson(response, 400, { error: r.error })
        return
      }
      sendJson(response, 200, { ok: true, userId: r.userId, provider: 'google_gmail' })
      return
    }

    if (request.method === 'GET' && url.pathname === '/oauth/slack/callback') {
      const r = await slackOAuthCallback(pool, url.searchParams)
      if ('error' in r) {
        sendJson(response, 400, { error: r.error })
        return
      }
      sendJson(response, 200, { ok: true, userId: r.userId, provider: 'slack' })
      return
    }

    if (request.method === 'POST' && url.pathname === '/mirachat/ingest/gmail') {
      const body = parseJson(await readBody(request))
      const userId = String(body.userId ?? 'demo-user')
      const r = await ingestGmailIntoMemory(pool, userId, Number(body.maxMessages ?? 15))
      if ('error' in r) {
        sendJson(response, 400, r)
        return
      }
      sendJson(response, 200, r)
      return
    }

    if (request.method === 'POST' && url.pathname === '/mirachat/ingest/slack') {
      const body = parseJson(await readBody(request))
      const userId = String(body.userId ?? 'demo-user')
      const channelId = String(body.channelId ?? '')
      if (!channelId) {
        sendJson(response, 400, { error: 'channelId required (Slack channel ID)' })
        return
      }
      const r = await ingestSlackIntoMemory(pool, userId, channelId, Number(body.maxMessages ?? 20))
      if ('error' in r) {
        sendJson(response, 400, r)
        return
      }
      sendJson(response, 200, r)
      return
    }

    if (request.method === 'POST' && url.pathname === '/mirachat/tools/negotiate') {
      const body = parseJson(await readBody(request))
      const threadRef = typeof body.threadRef === 'string' ? body.threadRef.trim() : ''
      const counterpartyText =
        typeof body.counterpartyText === 'string'
          ? body.counterpartyText.trim()
          : typeof body.message === 'string'
            ? body.message.trim()
            : ''
      const relationshipPriority = body.relationshipPriority ?? 'normal'
      const proposedSlots = stringList(body.proposedSlots)
      const constraints = stringList(body.constraints)
      const durationMinutes =
        body.durationMinutes == null ? 30 : Number(body.durationMinutes)
      const preference = body.preference ?? 'flex'

      if (!threadRef || !counterpartyText) {
        sendJson(response, 400, { error: 'threadRef and counterpartyText required' })
        return
      }
      if (!isRelationshipPriority(relationshipPriority)) {
        sendJson(response, 400, { error: 'relationshipPriority must be critical|high|normal|defer' })
        return
      }
      if (proposedSlots === null || constraints === null) {
        sendJson(response, 400, { error: 'proposedSlots and constraints must be string arrays when provided' })
        return
      }
      if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
        sendJson(response, 400, { error: 'durationMinutes must be a positive number' })
        return
      }
      if (!isPreference(preference)) {
        sendJson(response, 400, { error: 'preference must be morning|afternoon|flex' })
        return
      }
      const state = {
        threadRef,
        relationshipPriority,
        proposedSlots: proposedSlots ?? [],
        constraints: constraints ?? [],
        lastSpeaker: 'counterparty' as const,
      }
      const out = runNegotiationTurn({ state, counterpartyText })
      void insertDelegationEvent(pool, {
        eventType: DelegationEventType.NegotiationTurn,
        userId: String(body.userId ?? 'demo-user'),
        threadId: threadRef,
        metadata: { toolsUsed: out.toolsUsed },
      }).catch(() => {})
      sendJson(response, 200, {
        reply: out.reply,
        state: out.state,
        toolsUsed: out.toolsUsed,
        slotToolSample: toolProposeSlots({
          durationMinutes,
          preference,
          relationshipPriority,
        }),
      })
      return
    }

    if (request.method === 'GET' && url.pathname === '/mirachat/doer/openclaw/status') {
      const doer = getOpenClawDoer()
      const config = doer.getConfig()
      sendJson(response, 200, {
        provider: 'openclaw',
        configured: Boolean(config.defaultAgentId || config.defaultSessionId || config.defaultTo),
        config,
      })
      return
    }

    if (request.method === 'POST' && url.pathname === '/mirachat/doer/openclaw/run') {
      const body = parseJson(await readBody(request))
      const task = typeof body.task === 'string' ? body.task.trim() : ''
      if (!task) {
        sendJson(response, 400, { error: 'task required' })
        return
      }
      try {
        const result = await getOpenClawDoer().run({
          task,
          agentId: typeof body.agentId === 'string' ? body.agentId : undefined,
          sessionId: typeof body.sessionId === 'string' ? body.sessionId : undefined,
          to: typeof body.to === 'string' ? body.to : undefined,
          thinking: typeof body.thinking === 'string' ? body.thinking : undefined,
          timeoutSeconds: finitePositiveTimeoutSeconds(body.timeoutSeconds),
          deliver: body.deliver === true,
          channel: typeof body.channel === 'string' ? body.channel : undefined,
          replyTo: typeof body.replyTo === 'string' ? body.replyTo : undefined,
          replyChannel: typeof body.replyChannel === 'string' ? body.replyChannel : undefined,
          replyAccount: typeof body.replyAccount === 'string' ? body.replyAccount : undefined,
        })
        sendJson(response, 200, result)
      } catch (error) {
        sendJson(response, 502, {
          error: error instanceof Error ? error.message : String(error),
        })
      }
      return
    }

    if (request.method === 'POST' && url.pathname === '/a2a/propose') {
      const body = parseJson(await readBody(request))
      const fromUserId = String(body.fromUserId ?? '')
      const toUserId = String(body.toUserId ?? '')
      const intent = String(body.intent ?? '')
      if (!fromUserId || !toUserId || !intent) {
        sendJson(response, 400, { error: 'fromUserId, toUserId, intent required' })
        return
      }
      if (body.payload != null && !validateA2aPayload(body.payload)) {
        sendJson(response, 400, { error: 'payload must be a plain object' })
        return
      }
      const payload = validateA2aPayload(body.payload) ? body.payload : {}
      const id = await insertA2aEnvelope(pool, {
        fromUserId,
        toUserId,
        threadRef: body.threadRef != null ? String(body.threadRef) : null,
        intent,
        payload,
      })
      void insertDelegationEvent(pool, {
        eventType: DelegationEventType.A2aProposal,
        userId: fromUserId,
        threadId: body.threadRef != null ? String(body.threadRef) : null,
        metadata: { envelopeId: id, toUserId, intent },
      }).catch(() => {})
      sendJson(response, 201, { id, protocol: 'mira-a2a/0.1' })
      return
    }

    if (request.method === 'POST' && url.pathname === '/a2a/respond') {
      const body = parseJson(await readBody(request))
      const id = String(body.envelopeId ?? '')
      const status = body.status === 'accepted' || body.status === 'rejected' ? body.status : null
      if (!id || !status) {
        sendJson(response, 400, { error: 'envelopeId and status accepted|rejected required' })
        return
      }
      if (body.responsePayload != null && !validateA2aPayload(body.responsePayload)) {
        sendJson(response, 400, { error: 'responsePayload must be a plain object' })
        return
      }
      const responsePayload = validateA2aPayload(body.responsePayload)
        ? body.responsePayload
        : {}
      const row = await respondA2aEnvelope(pool, id, { status, responsePayload })
      if (!row) {
        sendJson(response, 404, { error: 'envelope not found or not proposed' })
        return
      }
      void insertDelegationEvent(pool, {
        eventType: DelegationEventType.A2aResponse,
        userId: row.to_user_id,
        threadId: row.thread_ref,
        metadata: { envelopeId: id, status },
      }).catch(() => {})
      sendJson(response, 200, row)
      return
    }

    if (request.method === 'GET' && url.pathname === '/a2a/inbox') {
      const userId = url.searchParams.get('userId') ?? 'demo-user'
      const role = url.searchParams.get('role') === 'from' ? 'from' : 'to'
      const rows = await listA2aEnvelopesForUser(pool, userId, role, 80)
      sendJson(response, 200, rows)
      return
    }

    if (request.method === 'GET' && url.pathname === '/mirachat/delegation-events') {
      const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') ?? 100)))
      const events = await listDelegationEvents(pool, limit)
      sendJson(response, 200, events)
      return
    }

    if (request.method === 'GET' && url.pathname === '/mirachat/metrics') {
      const days = Math.min(366, Math.max(1, Number(url.searchParams.get('days') ?? 7)))
      const userId = url.searchParams.get('userId')
      const until = new Date()
      const since = new Date(until.getTime() - days * 86_400_000)
      const rollup = await queryGqmRollup(pool, {
        userId: userId && userId.trim() ? userId : null,
        since,
        until,
      })
      sendJson(response, 200, rollup)
      return
    }

    if (request.method === 'GET' && url.pathname === '/mirachat/identity') {
      const userId = url.searchParams.get('userId') ?? 'demo-user'
      const profile = await mirachatIdentity.getIdentity(userId)
      sendJson(response, 200, profile)
      return
    }

    if (request.method === 'PUT' && url.pathname === '/mirachat/identity') {
      const body = parseJson(await readBody(request)) as unknown as IdentityProfile
      if (!body?.userId) {
        sendJson(response, 400, { error: 'userId required' })
        return
      }
      await mirachatIdentity.upsertIdentity(body)
      void insertDelegationEvent(pool, {
        eventType: DelegationEventType.IdentityUpdated,
        userId: body.userId,
        metadata: {
          style_guide_count: Array.isArray(body.styleGuide) ? body.styleGuide.length : 0,
          hard_boundary_count: Array.isArray(body.hardBoundaries) ? body.hardBoundaries.length : 0,
        },
      }).catch(() => {})
      sendJson(response, 200, { ok: true })
      return
    }

    if (request.method === 'GET' && url.pathname === '/mirachat/relationship') {
      const userId = url.searchParams.get('userId') ?? 'demo-user'
      const contactId = url.searchParams.get('contactId')
      if (!contactId) {
        sendJson(response, 400, { error: 'contactId query required' })
        return
      }
      const rel = await mirachatIdentity.getRelationship(userId, contactId)
      sendJson(response, 200, rel)
      return
    }

    if (request.method === 'PUT' && url.pathname === '/mirachat/relationship') {
      const body = parseJson(await readBody(request)) as unknown as RelationshipProfile
      if (!body?.userId || !body?.contactId) {
        sendJson(response, 400, { error: 'userId and contactId required' })
        return
      }
      await mirachatIdentity.upsertRelationship(body)
      void insertDelegationEvent(pool, {
        eventType: DelegationEventType.RelationshipUpdated,
        userId: body.userId,
        threadId: body.contactId,
        metadata: {
          risk_level: body.riskLevel,
          note_count: Array.isArray(body.notes) ? body.notes.length : 0,
        },
      }).catch(() => {})
      sendJson(response, 200, { ok: true })
      return
    }

    if (request.method === 'POST' && url.pathname === '/mirachat/delegation-mode') {
      const body = parseJson(await readBody(request))
      const userId = String(body.userId ?? '').trim()
      const threadId = String(body.threadId ?? '').trim()
      const channel = body.channel != null ? String(body.channel) : null
      const accountId = body.accountId != null ? String(body.accountId) : null
      const fromMode = body.fromMode
      const toMode = body.toMode
      if (!userId || !threadId) {
        sendJson(response, 400, { error: 'userId and threadId required' })
        return
      }
      if (!isMode(fromMode) || !isMode(toMode)) {
        sendJson(response, 400, { error: 'fromMode and toMode must be assist|approve|auto' })
        return
      }
      const rank = { assist: 0, approve: 1, auto: 2 } as const
      const direction =
        rank[toMode] > rank[fromMode]
          ? 'increase'
          : rank[toMode] < rank[fromMode]
            ? 'decrease'
            : 'same'

      await setRelationshipAutoReplyEnabled(pool, {
        userId,
        contactId: threadId,
        enabled: toMode === 'auto',
      })

      await insertDelegationEvent(pool, {
        eventType: DelegationEventType.ModeChanged,
        userId,
        channel,
        accountId,
        threadId,
        metadata: {
          from_mode: fromMode,
          to_mode: toMode,
          direction,
        },
      })

      if (rank[toMode] < rank[fromMode]) {
        await insertDelegationEvent(pool, {
          eventType: DelegationEventType.TrustRegression,
          userId,
          channel,
          accountId,
          threadId,
          metadata: {
            from_mode: fromMode,
            to_mode: toMode,
            reason: body.reason != null ? String(body.reason) : 'manual_mode_decrease',
          },
        })
      }

      sendJson(response, 200, {
        ok: true,
        userId,
        threadId,
        fromMode,
        toMode,
        direction,
        autoReplyEnabled: toMode === 'auto',
      })
      return
    }

    if (request.method === 'POST' && url.pathname === '/mirachat/feedback') {
      const body = parseJson(await readBody(request))
      const userId = String(body.userId ?? '').trim()
      const type = String(body.type ?? '').trim()
      const draftId = body.draftId != null ? String(body.draftId) : null
      const threadId = body.threadId != null ? String(body.threadId) : null
      const note = body.note != null ? String(body.note) : null
      if (!userId) {
        sendJson(response, 400, { error: 'userId required' })
        return
      }
      let eventType: string | null = null
      const metadata: Record<string, unknown> = {}
      if (type === 'sounds_like_me') {
        const score = Number(body.score)
        if (!Number.isFinite(score) || score < 1 || score > 5) {
          sendJson(response, 400, { error: 'score must be 1-5 for sounds_like_me feedback' })
          return
        }
        eventType = DelegationEventType.FeedbackSoundsLikeMe
        metadata.score = score
      } else if (type === 'regret') {
        eventType = DelegationEventType.FeedbackRegret
        metadata.severity = typeof body.severity === 'string' ? body.severity : 'normal'
      } else if (type === 'boundary_violation') {
        eventType = DelegationEventType.FeedbackBoundaryViolation
      } else {
        sendJson(response, 400, { error: 'type must be sounds_like_me|regret|boundary_violation' })
        return
      }
      if (note && note.trim()) {
        metadata.note = note.trim()
      }
      await insertDelegationEvent(pool, {
        eventType,
        userId,
        threadId,
        draftId,
        metadata,
      })
      sendJson(response, 200, { ok: true })
      return
    }

    if (request.method === 'POST' && url.pathname === '/mirachat/instrumentation/twilio-status') {
      const body = parseJson(await readBody(request))
      await insertDelegationEvent(pool, {
        eventType: DelegationEventType.TwilioMessageStatus,
        metadata: {
          MessageSid: body.MessageSid,
          MessageStatus: body.MessageStatus,
          To: body.To,
          From: body.From,
          ErrorCode: body.ErrorCode,
        },
      })
      sendJson(response, 200, { ok: true })
      return
    }

    if (request.method === 'GET' && url.pathname === '/mirachat/threads') {
      const userId = url.searchParams.get('userId') ?? 'demo-user'
      const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? 50)))
      const threads = await listThreadSummariesForUser(pool, userId, limit)
      sendJson(response, 200, threads)
      return
    }

    if (request.method === 'GET' && url.pathname === '/mirachat/thread') {
      const threadId = url.searchParams.get('threadId')
      if (!threadId?.trim()) {
        sendJson(response, 400, { error: 'threadId query required' })
        return
      }
      const messages = await mirachatMemory.getRecentMessages(threadId.trim())
      sendJson(response, 200, { threadId: threadId.trim(), messages })
      return
    }

    if (request.method === 'GET' && url.pathname === '/mirachat/drafts') {
      const drafts = await listDraftedOutboundTriage(pool, 200)
      sendJson(
        response,
        200,
        drafts.map(d => ({
          id: d.id,
          threadId: d.thread_id,
          inboundText: d.inbound_raw_text,
          generatedText: d.generated_text,
          confidenceScore: d.confidence_score,
          ruleTriggered: d.rule_triggered,
          intentSummary: d.intent_summary,
          replyOptions: d.reply_options,
          threadSummary: d.thread_summary,
          createdAt: d.created_at,
        })),
      )
      return
    }

    if (request.method === 'POST' && url.pathname.match(/^\/mirachat\/drafts\/[^/]+\/approve$/)) {
      const id = url.pathname.split('/')[3]!
      const body = parseJson(await readBody(request))
      const draft = await getOutboundDraft(pool, id)
      const fallbackTask = draft?.edited_text?.trim() || draft?.generated_text || ''
      let doerRequest: OpenClawDoerRequest | null = null
      try {
        doerRequest = parseOpenClawDoerRequest(body, fallbackTask)
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) })
        return
      }
      if (!draft || draft.status !== 'DRAFTED') {
        sendJson(response, 404, { error: 'Draft not found or not triageable' })
        return
      }
      let doerResult: unknown
      if (doerRequest) {
        try {
          doerResult = await runOpenClawDoerForDraft(pool, getOpenClawDoer(), {
            request: doerRequest,
            draftId: draft.id,
            userId: draft.user_id,
            channel: draft.channel,
            accountId: draft.account_id,
            threadId: draft.thread_id,
            inboundMessageId: draft.inbound_message_id,
          })
        } catch (error) {
          sendJson(response, 502, { error: error instanceof Error ? error.message : String(error) })
          return
        }
      }
      const row = doerRequest
        ? await approveAndMarkSentOutboundDraft(pool, id)
        : await approveOutboundDraft(pool, id)
      if (row) {
        void insertDelegationEvent(pool, {
          eventType: DelegationEventType.DraftApprovedAsIs,
          userId: row.user_id,
          channel: row.channel,
          accountId: row.account_id,
          threadId: row.thread_id,
          draftId: row.id,
          inboundMessageId: row.inbound_message_id,
          metadata: {},
        }).catch(err => console.error('[measurement] draft.approved_as_is', err))
        if (doerRequest) {
          void insertDelegationEvent(pool, {
            eventType: DelegationEventType.OutboundSent,
            userId: row.user_id,
            channel: row.channel,
            accountId: row.account_id,
            threadId: row.thread_id,
            draftId: row.id,
            inboundMessageId: row.inbound_message_id,
            metadata: { source: 'human_approval_openclaw_doer' },
          }).catch(err => console.error('[measurement] outbound.sent (openclaw doer)', err))
        }
      }
      sendJson(
        response,
        row ? 200 : 404,
        row ? (doerResult ? { draft: row, doer: doerResult } : row) : { error: 'Draft not found or not triageable' },
      )
      return
    }

    if (request.method === 'POST' && url.pathname.match(/^\/mirachat\/drafts\/[^/]+\/reject$/)) {
      const id = url.pathname.split('/')[3]!
      const row = await rejectOutboundDraft(pool, id)
      if (row) {
        void insertDelegationEvent(pool, {
          eventType: DelegationEventType.DraftRejected,
          userId: row.user_id,
          channel: row.channel,
          accountId: row.account_id,
          threadId: row.thread_id,
          draftId: row.id,
          inboundMessageId: row.inbound_message_id,
          metadata: {},
        }).catch(err => console.error('[measurement] draft.rejected', err))
      }
      sendJson(response, row ? 200 : 404, row ?? { error: 'Draft not found or not triageable' })
      return
    }

    if (request.method === 'POST' && url.pathname.match(/^\/mirachat\/drafts\/[^/]+\/edit$/)) {
      const id = url.pathname.split('/')[3]!
      const body = parseJson(await readBody(request))
      const editedText = String(body.editedText ?? '')
      let doerRequest: OpenClawDoerRequest | null = null
      try {
        doerRequest = parseOpenClawDoerRequest(body, editedText.trim())
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) })
        return
      }
      const draft = await getOutboundDraft(pool, id)
      if (!draft || draft.status !== 'DRAFTED') {
        sendJson(response, 404, { error: 'Draft not found or not triageable' })
        return
      }
      let doerResult: unknown
      if (doerRequest) {
        try {
          doerResult = await runOpenClawDoerForDraft(pool, getOpenClawDoer(), {
            request: doerRequest,
            draftId: draft.id,
            userId: draft.user_id,
            channel: draft.channel,
            accountId: draft.account_id,
            threadId: draft.thread_id,
            inboundMessageId: draft.inbound_message_id,
          })
        } catch (error) {
          sendJson(response, 502, { error: error instanceof Error ? error.message : String(error) })
          return
        }
      }
      const row = doerRequest
        ? await editApproveAndMarkSentOutboundDraft(pool, id, editedText)
        : await editAndApproveOutboundDraft(pool, id, editedText)
      if (row) {
        const gen = row.generated_text ?? ''
        const ed = row.edited_text ?? ''
        void insertDelegationEvent(pool, {
          eventType: DelegationEventType.DraftApprovedWithEdit,
          userId: row.user_id,
          channel: row.channel,
          accountId: row.account_id,
          threadId: row.thread_id,
          draftId: row.id,
          inboundMessageId: row.inbound_message_id,
          metadata: { generated_len: gen.length, edited_len: ed.length },
        }).catch(err => console.error('[measurement] draft.approved_with_edit', err))
        if (doerRequest) {
          void insertDelegationEvent(pool, {
            eventType: DelegationEventType.OutboundSent,
            userId: row.user_id,
            channel: row.channel,
            accountId: row.account_id,
            threadId: row.thread_id,
            draftId: row.id,
            inboundMessageId: row.inbound_message_id,
            metadata: { source: 'human_edit_openclaw_doer' },
          }).catch(err => console.error('[measurement] outbound.sent (openclaw doer)', err))
        }
      }
      sendJson(
        response,
        row ? 200 : 404,
        row ? (doerResult ? { draft: row, doer: doerResult } : row) : { error: 'Draft not found or not triageable' },
      )
      return
    }

    if (request.method === 'POST' && url.pathname.match(/^\/mirachat\/drafts\/[^/]+\/select-option$/)) {
      const id = url.pathname.split('/')[3]!
      const body = parseJson(await readBody(request))
      const index = Number(body.index ?? body.optionIndex ?? -1)
      const draft = await getOutboundDraft(pool, id)
      const selectedText =
        draft?.reply_options && Array.isArray(draft.reply_options) && index >= 0 && index < draft.reply_options.length
          ? String(draft.reply_options[index]?.text ?? '')
          : ''
      let doerRequest: OpenClawDoerRequest | null = null
      try {
        doerRequest = parseOpenClawDoerRequest(body, selectedText.trim())
      } catch (error) {
        sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) })
        return
      }
      if (!draft || draft.status !== 'DRAFTED') {
        sendJson(response, 404, { error: 'Draft not found, invalid option, or not triageable' })
        return
      }
      if (!selectedText.trim()) {
        sendJson(response, 404, { error: 'Draft not found, invalid option, or not triageable' })
        return
      }
      let doerResult: unknown
      if (doerRequest) {
        try {
          doerResult = await runOpenClawDoerForDraft(pool, getOpenClawDoer(), {
            request: doerRequest,
            draftId: draft.id,
            userId: draft.user_id,
            channel: draft.channel,
            accountId: draft.account_id,
            threadId: draft.thread_id,
            inboundMessageId: draft.inbound_message_id,
          })
        } catch (error) {
          sendJson(response, 502, { error: error instanceof Error ? error.message : String(error) })
          return
        }
      }
      const row = doerRequest
        ? await selectReplyOptionApproveAndMarkSent(pool, id, index)
        : await selectReplyOptionAndApprove(pool, id, index)
      if (row) {
        void insertDelegationEvent(pool, {
          eventType: DelegationEventType.DraftApprovedWithEdit,
          userId: row.user_id,
          channel: row.channel,
          accountId: row.account_id,
          threadId: row.thread_id,
          draftId: row.id,
          inboundMessageId: row.inbound_message_id,
          metadata: { source: 'select_option', option_index: index },
        }).catch(err => console.error('[measurement] draft.approved_with_edit (option)', err))
        if (doerRequest) {
          void insertDelegationEvent(pool, {
            eventType: DelegationEventType.OutboundSent,
            userId: row.user_id,
            channel: row.channel,
            accountId: row.account_id,
            threadId: row.thread_id,
            draftId: row.id,
            inboundMessageId: row.inbound_message_id,
            metadata: { source: 'human_select_option_openclaw_doer', option_index: index },
          }).catch(err => console.error('[measurement] outbound.sent (openclaw doer)', err))
        }
      }
      sendJson(
        response,
        row ? 200 : 404,
        row
          ? (doerResult ? { draft: row, doer: doerResult } : row)
          : { error: 'Draft not found, invalid option, or not triageable' },
      )
      return
    }

    if (request.method === 'GET' && url.pathname === '/mirachat/connection') {
      const channel = url.searchParams.get('channel') ?? 'wechat'
      const accountId = url.searchParams.get('accountId') ?? 'default-account'
      const row = await getUserConnection(pool, channel, accountId)
      sendJson(response, 200, row ?? { status: 'UNKNOWN' })
      return
    }

    if (request.method === 'PATCH' && url.pathname === '/mirachat/connection/auth') {
      const body = parseJson(await readBody(request))
      const channel = String(body.channel ?? 'wechat')
      const accountId = String(body.accountId ?? 'default-account')
      const userId = String(body.userId ?? 'demo-user')
      const status = String(body.status ?? 'AUTH_REQUIRED') as 'ONLINE' | 'OFFLINE' | 'AUTH_REQUIRED'
      const qrPayload = body.qrPayload != null ? String(body.qrPayload) : null
      await upsertUserConnectionAuth(pool, { channel, accountId, userId, status, qrPayload })
      await appendOutboxEvent(pool, 'connection.auth', { channel, accountId, status, qrPayload })
      sendJson(response, 200, { ok: true })
      return
    }

    if (request.method === 'GET' && url.pathname === '/mirachat/pending-send') {
      const channel = url.searchParams.get('channel') ?? 'wechat'
      const accountId = url.searchParams.get('accountId') ?? 'default-account'
      const pending = await listPendingSend(pool, channel, accountId, 50)
      sendJson(
        response,
        200,
        pending.map(p => ({
          id: p.id,
          threadId: p.thread_id,
          contactId: p.contact_id,
          roomId: p.room_id,
          text: p.edited_text && p.edited_text.trim() ? p.edited_text : p.generated_text,
          channel: p.channel,
          accountId: p.account_id,
        })),
      )
      return
    }

    if (request.method === 'POST' && url.pathname.match(/^\/mirachat\/drafts\/[^/]+\/mark-sent$/)) {
      const id = url.pathname.split('/')[3]!
      const row = await markOutboundSent(pool, id)
      if (row) {
        const wasAutoQueued = await draftHasEventType(pool, row.id, DelegationEventType.DraftAutoQueued)
        void insertDelegationEvent(pool, {
          eventType: DelegationEventType.OutboundSent,
          userId: row.user_id,
          channel: row.channel,
          accountId: row.account_id,
          threadId: row.thread_id,
          draftId: row.id,
          inboundMessageId: row.inbound_message_id,
          metadata: { source: wasAutoQueued ? 'policy_auto_send' : 'human_approved_queue' },
        }).catch(err => console.error('[measurement] outbound.sent', err))
        if (wasAutoQueued) {
          void insertDelegationEvent(pool, {
            eventType: DelegationEventType.DraftAutoSent,
            userId: row.user_id,
            channel: row.channel,
            accountId: row.account_id,
            threadId: row.thread_id,
            draftId: row.id,
            inboundMessageId: row.inbound_message_id,
            metadata: {},
          }).catch(err => console.error('[measurement] draft.auto_sent', err))
        }
      }
      sendJson(response, row ? 200 : 404, row ?? { error: 'Draft not found or not ready to mark sent' })
      return
    }

    if (request.method === 'POST' && url.pathname.match(/^\/mirachat\/drafts\/[^/]+\/mark-send-failed$/)) {
      const id = url.pathname.split('/')[3]!
      const body = parseJson(await readBody(request))
      const error =
        typeof body.error === 'string' && body.error.trim() ? body.error.trim() : 'gateway send failed'
      const row = await markOutboundSendFailed(pool, {
        id,
        error,
        maxAttempts: Number(body.maxAttempts ?? 3),
        retryDelaySeconds: Number(body.retryDelaySeconds ?? 60),
      })
      if (row) {
        void insertDelegationEvent(pool, {
          eventType: DelegationEventType.OutboundSendFailed,
          userId: row.user_id,
          channel: row.channel,
          accountId: row.account_id,
          threadId: row.thread_id,
          draftId: row.id,
          inboundMessageId: row.inbound_message_id,
          metadata: {
            error,
            send_attempt_count: row.send_attempt_count,
            dead_lettered: row.status === 'FAILED',
            next_send_after: row.next_send_after?.toISOString() ?? null,
          },
        }).catch(err => console.error('[measurement] outbound.send_failed', err))
      }
      sendJson(response, row ? 200 : 404, row ?? { error: 'Draft not found or not ready to mark send failed' })
      return
    }

      sendJson(response, 404, { error: 'Not found' })
    } catch (error) {
      console.error('[api-listener] request failed', {
        method: request.method,
        url: request.url,
        error: error instanceof Error ? error.message : String(error),
      })
      if (!response.headersSent) {
        sendJson(response, 500, {
          error: error instanceof Error ? error.message : 'Internal server error',
        })
      } else {
        response.end()
      }
    }
  }
}
