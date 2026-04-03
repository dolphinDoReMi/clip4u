import type { Pool } from 'pg'

export type UserConnectionStatus = 'ONLINE' | 'OFFLINE' | 'AUTH_REQUIRED'
export type InboundStatus = 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED'
export type OutboundStatus = 'DRAFTED' | 'APPROVED' | 'REJECTED' | 'SENT' | 'FAILED'

export interface UserConnectionRow {
  id: string
  channel: string
  account_id: string
  user_id: string
  status: UserConnectionStatus
  qr_payload: string | null
  qr_updated_at: Date | null
  updated_at: Date
}

export interface InboundMessageRow {
  id: string
  user_connection_id: string | null
  contact_id: string
  room_id: string | null
  thread_id: string
  raw_text: string
  received_at: Date
  status: InboundStatus
  channel: string
  account_id: string
  user_id: string
  sender_id: string
  message_id: string | null
  error: string | null
}

export interface ReplyOptionRow {
  label: string
  text: string
}

export interface OutboundDraftRow {
  id: string
  inbound_message_id: string | null
  generated_text: string
  confidence_score: number
  status: OutboundStatus
  rule_triggered: string | null
  edited_text: string | null
  approved_at: Date | null
  sent_at: Date | null
  channel: string
  account_id: string
  user_id: string
  thread_id: string
  intent_summary: string | null
  reply_options: ReplyOptionRow[] | null
  thread_summary: string | null
  send_attempt_count: number
  last_send_attempt_at: Date | null
  last_send_error: string | null
  next_send_after: Date | null
  dead_lettered_at: Date | null
  created_at: Date
  updated_at: Date
}

export interface PendingSendRow extends OutboundDraftRow {
  contact_id: string | null
  room_id: string | null
}

export interface DelegationEventRow {
  id: string
  event_type: string
  user_id: string | null
  channel: string | null
  account_id: string | null
  thread_id: string | null
  policy_action: string | null
  confidence: number | null
  policy_rule_id: string | null
  draft_id: string | null
  inbound_message_id: string | null
  metadata: Record<string, unknown>
  created_at: Date
}

export interface GqmRollup {
  since: string
  until: string
  userId: string | null
  eventCounts: Record<string, number>
  policyActionCounts: Record<string, number>
  approvalWithoutEditRate: number | null
  asIsApprovals: number
  editedApprovals: number
  avgSoundsLikeMeScore: number | null
  regretRate: number | null
  boundaryViolationRate: number | null
  overview: {
    activeUsers: number
    activeThreads: number
    inboundEnqueued: number
    assistGenerated: number
    summariesGenerated: number
    draftsCreated: number
    autoQueued: number
    approvals: number
    sent: number
    autoSent: number
    humanSent: number
    rejected: number
    modeChanges: number
    trustRegressions: number
    assistedOrDelegatedRate: number | null
  }
  trust: {
    autoEligibleRate: number | null
    reviewRate: number | null
    blockRate: number | null
    approvalWithoutEditRate: number | null
    avgSoundsLikeMeScore: number | null
    regretRate: number | null
    boundaryViolationRate: number | null
  }
  productivity: {
    avgDraftLatencySeconds: number | null
    avgApprovalLatencySeconds: number | null
    avgSendLatencySeconds: number | null
    avgResolutionSeconds: number | null
    timeToValueSeconds: number | null
  }
  identity: {
    relationshipCount: number
    highRiskRelationshipCount: number
    autoReplyEnabledCount: number
    hardConstraintCount: number
    memoryChunkCount: number
    oauthConnections: number
    ingestsCompleted: number
  }
  coordination: {
    negotiationTurns: number
    a2aProposals: number
    a2aResponses: number
    doerStarted: number
    doerCompleted: number
    doerFailed: number
  }
  dailySeries: Array<{
    day: string
    inboundEnqueued: number
    assistGenerated: number
    draftsCreated: number
    autoQueued: number
    approvedAsIs: number
    approvedWithEdit: number
    sent: number
    autoSent: number
    policyReview: number
    policyBlock: number
    policyAutoSend: number
  }>
}

export const upsertUserConnection = async (
  pool: Pool,
  input: { channel: string; accountId: string; userId: string; status?: UserConnectionStatus },
): Promise<string> => {
  const status = input.status ?? 'ONLINE'
  const { rows } = await pool.query<{ id: string }>(
    `
    INSERT INTO user_connections (channel, account_id, user_id, status)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (channel, account_id) DO UPDATE
      SET user_id = EXCLUDED.user_id,
          status = EXCLUDED.status,
          updated_at = now()
    RETURNING id
    `,
    [input.channel, input.accountId, input.userId, status],
  )
  return rows[0]!.id
}

export const upsertUserConnectionAuth = async (
  pool: Pool,
  input: {
    channel: string
    accountId: string
    userId: string
    status: UserConnectionStatus
    qrPayload?: string | null
  },
): Promise<void> => {
  await pool.query(
    `
    INSERT INTO user_connections (channel, account_id, user_id, status, qr_payload, qr_updated_at)
    VALUES ($1, $2, $3, $4, $5::text, CASE WHEN $5::text IS NOT NULL THEN now() ELSE NULL END)
    ON CONFLICT (channel, account_id) DO UPDATE SET
      user_id = EXCLUDED.user_id,
      status = EXCLUDED.status,
      qr_payload = EXCLUDED.qr_payload,
      qr_updated_at = CASE WHEN EXCLUDED.qr_payload IS NOT NULL THEN now() ELSE NULL END,
      updated_at = now()
    `,
    [input.channel, input.accountId, input.userId, input.status, input.qrPayload ?? null],
  )
}

export const getUserConnection = async (
  pool: Pool,
  channel: string,
  accountId: string,
): Promise<UserConnectionRow | null> => {
  const { rows } = await pool.query<UserConnectionRow>(
    `SELECT * FROM user_connections WHERE channel = $1 AND account_id = $2`,
    [channel, accountId],
  )
  return rows[0] ?? null
}

export const insertInboundMessage = async (
  pool: Pool,
  input: {
    userConnectionId: string | null
    contactId: string
    roomId: string | null
    threadId: string
    rawText: string
    channel: string
    accountId: string
    userId: string
    senderId: string
    messageId: string | null
  },
): Promise<string> => {
  const { rows } = await pool.query<{ id: string }>(
    `
    INSERT INTO inbound_messages (
      user_connection_id, contact_id, room_id, thread_id, raw_text, status,
      channel, account_id, user_id, sender_id, message_id
    )
    VALUES ($1, $2, $3, $4, $5, 'PENDING', $6, $7, $8, $9, $10)
    RETURNING id
    `,
    [
      input.userConnectionId,
      input.contactId,
      input.roomId,
      input.threadId,
      input.rawText,
      input.channel,
      input.accountId,
      input.userId,
      input.senderId,
      input.messageId,
    ],
  )
  return rows[0]!.id
}

export const getInboundMessage = async (pool: Pool, id: string): Promise<InboundMessageRow | null> => {
  const { rows } = await pool.query<InboundMessageRow>(`SELECT * FROM inbound_messages WHERE id = $1`, [id])
  return rows[0] ?? null
}

export const setInboundStatus = async (
  pool: Pool,
  id: string,
  status: InboundStatus,
  error?: string | null,
): Promise<void> => {
  await pool.query(`UPDATE inbound_messages SET status = $2, error = $3 WHERE id = $1`, [id, status, error ?? null])
}

/** Inbound rows waiting for the worker (same channel/account as the active gateway preset). */
export const countPendingInboundForUser = async (
  pool: Pool,
  userId: string,
  channel: string,
  accountId: string,
): Promise<number> => {
  const { rows } = await pool.query<{ n: string }>(
    `
    SELECT COUNT(*)::text AS n
    FROM inbound_messages
    WHERE user_id = $1 AND channel = $2 AND account_id = $3 AND status = 'PENDING'
    `,
    [userId, channel, accountId],
  )
  return Number(rows[0]?.n ?? 0)
}

export const listPendingInboundIdsForUser = async (
  pool: Pool,
  userId: string,
  channel: string,
  accountId: string,
  limit = 100,
): Promise<string[]> => {
  const cap = Math.min(Math.max(1, limit), 200)
  const { rows } = await pool.query<{ id: string }>(
    `
    SELECT id::text
    FROM inbound_messages
    WHERE user_id = $1 AND channel = $2 AND account_id = $3 AND status = 'PENDING'
    ORDER BY received_at ASC
    LIMIT $4
    `,
    [userId, channel, accountId, cap],
  )
  return rows.map(r => r.id)
}

export const insertOutboundDraft = async (
  pool: Pool,
  input: {
    inboundMessageId: string | null
    generatedText: string
    confidenceScore: number
    status: OutboundStatus
    ruleTriggered: string | null
    channel: string
    accountId: string
    userId: string
    threadId: string
    intentSummary: string | null
    replyOptions?: ReplyOptionRow[] | null
    threadSummary?: string | null
    /** When status is APPROVED (e.g. policy AUTO_SEND), sets approved_at for pending-send pickup. */
    approvedAt?: Date | null
  },
): Promise<OutboundDraftRow> => {
  const approvedAt =
    input.approvedAt ??
    (input.status === 'APPROVED' ? new Date() : null)
  const { rows } = await pool.query<OutboundDraftRow>(
    `
    INSERT INTO outbound_drafts (
      inbound_message_id, generated_text, confidence_score, status, rule_triggered,
      channel, account_id, user_id, thread_id, intent_summary, reply_options, thread_summary, approved_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13)
    RETURNING *
    `,
    [
      input.inboundMessageId,
      input.generatedText,
      input.confidenceScore,
      input.status,
      input.ruleTriggered,
      input.channel,
      input.accountId,
      input.userId,
      input.threadId,
      input.intentSummary,
      input.replyOptions?.length ? JSON.stringify(input.replyOptions) : null,
      input.threadSummary ?? null,
      approvedAt,
    ],
  )
  return rows[0]!
}

export const listDraftedOutbound = async (pool: Pool, limit = 100): Promise<OutboundDraftRow[]> => {
  const { rows } = await pool.query<OutboundDraftRow>(
    `
    SELECT d.* FROM outbound_drafts d
    WHERE d.status = 'DRAFTED'
    ORDER BY d.created_at DESC
    LIMIT $1
    `,
    [limit],
  )
  return rows
}

export const setRelationshipAutoReplyEnabled = async (
  pool: Pool,
  input: { userId: string; contactId: string; enabled: boolean },
): Promise<void> => {
  await pool.query(
    `
    INSERT INTO relationship_graph (
      user_id, contact_id, relationship_type, auto_reply_enabled, tone_profile, risk_level, notes
    )
    VALUES ($1, $2, 'unknown', $3, 'warm', 'medium', '{}')
    ON CONFLICT (user_id, contact_id) DO UPDATE SET
      auto_reply_enabled = EXCLUDED.auto_reply_enabled
    `,
    [input.userId, input.contactId, input.enabled],
  )
}

export interface OutboundDraftTriageRow extends OutboundDraftRow {
  inbound_raw_text: string | null
}

export const listDraftedOutboundTriage = async (pool: Pool, limit = 100): Promise<OutboundDraftTriageRow[]> => {
  const { rows } = await pool.query<OutboundDraftTriageRow>(
    `
    SELECT d.*, i.raw_text AS inbound_raw_text
    FROM outbound_drafts d
    LEFT JOIN inbound_messages i ON i.id = d.inbound_message_id
    WHERE d.status = 'DRAFTED'
    ORDER BY d.created_at DESC
    LIMIT $1
    `,
    [limit],
  )
  return rows
}

export const listDraftedOutboundTriageForUser = async (
  pool: Pool,
  userId: string,
  limit = 100,
): Promise<OutboundDraftTriageRow[]> => {
  const cap = Math.min(Math.max(1, limit), 200)
  const { rows } = await pool.query<OutboundDraftTriageRow>(
    `
    SELECT d.*, i.raw_text AS inbound_raw_text
    FROM outbound_drafts d
    LEFT JOIN inbound_messages i ON i.id = d.inbound_message_id
    WHERE d.status = 'DRAFTED' AND d.user_id = $1
    ORDER BY d.created_at DESC
    LIMIT $2
    `,
    [userId, cap],
  )
  return rows
}

export const listDraftedOutboundTriageForSession = async (
  pool: Pool,
  input: {
    userId: string
    channel: string
    accountId: string
    limit?: number
  },
): Promise<OutboundDraftTriageRow[]> => {
  const cap = Math.min(Math.max(1, input.limit ?? 100), 200)
  const { rows } = await pool.query<OutboundDraftTriageRow>(
    `
    SELECT d.*, i.raw_text AS inbound_raw_text
    FROM outbound_drafts d
    LEFT JOIN inbound_messages i ON i.id = d.inbound_message_id
    WHERE d.status = 'DRAFTED'
      AND d.user_id = $1
      AND d.channel = $2
      AND d.account_id = $3
    ORDER BY d.created_at DESC
    LIMIT $4
    `,
    [input.userId, input.channel, input.accountId, cap],
  )
  return rows
}

export const getOutboundDraft = async (pool: Pool, id: string): Promise<OutboundDraftRow | null> => {
  const { rows } = await pool.query<OutboundDraftRow>(`SELECT * FROM outbound_drafts WHERE id = $1`, [id])
  return rows[0] ?? null
}

export const approveOutboundDraft = async (pool: Pool, id: string): Promise<OutboundDraftRow | null> => {
  const { rows } = await pool.query<OutboundDraftRow>(
    `
    UPDATE outbound_drafts
    SET status = 'APPROVED', approved_at = now(), updated_at = now()
    WHERE id = $1 AND status = 'DRAFTED'
    RETURNING *
    `,
    [id],
  )
  return rows[0] ?? null
}

export const approveAndMarkSentOutboundDraft = async (
  pool: Pool,
  id: string,
): Promise<OutboundDraftRow | null> => {
  const { rows } = await pool.query<OutboundDraftRow>(
    `
    UPDATE outbound_drafts
    SET status = 'SENT',
        approved_at = now(),
        sent_at = now(),
        send_attempt_count = send_attempt_count + 1,
        last_send_attempt_at = now(),
        last_send_error = NULL,
        next_send_after = NULL,
        dead_lettered_at = NULL,
        updated_at = now()
    WHERE id = $1 AND status = 'DRAFTED'
    RETURNING *
    `,
    [id],
  )
  return rows[0] ?? null
}

export const rejectOutboundDraft = async (pool: Pool, id: string): Promise<OutboundDraftRow | null> => {
  const { rows } = await pool.query<OutboundDraftRow>(
    `
    UPDATE outbound_drafts
    SET status = 'REJECTED', updated_at = now()
    WHERE id = $1 AND status = 'DRAFTED'
    RETURNING *
    `,
    [id],
  )
  return rows[0] ?? null
}

export const rejectSupersededDraftsForThread = async (
  pool: Pool,
  input: {
    keepDraftId: string
    channel: string
    accountId: string
    userId: string
    threadId: string
    createdAt: Date
  },
): Promise<OutboundDraftRow[]> => {
  const { rows } = await pool.query<OutboundDraftRow>(
    `
    UPDATE outbound_drafts
    SET status = 'REJECTED',
        updated_at = now()
    WHERE status = 'DRAFTED'
      AND channel = $1
      AND account_id = $2
      AND user_id = $3
      AND thread_id = $4
      AND created_at < $5
      AND id <> $6
    RETURNING *
    `,
    [input.channel, input.accountId, input.userId, input.threadId, input.createdAt, input.keepDraftId],
  )
  return rows
}

export const editAndApproveOutboundDraft = async (
  pool: Pool,
  id: string,
  editedText: string,
): Promise<OutboundDraftRow | null> => {
  const { rows } = await pool.query<OutboundDraftRow>(
    `
    UPDATE outbound_drafts
    SET status = 'APPROVED',
        edited_text = $2,
        approved_at = now(),
        updated_at = now()
    WHERE id = $1 AND status = 'DRAFTED'
    RETURNING *
    `,
    [id, editedText],
  )
  return rows[0] ?? null
}

export const editApproveAndMarkSentOutboundDraft = async (
  pool: Pool,
  id: string,
  editedText: string,
): Promise<OutboundDraftRow | null> => {
  const { rows } = await pool.query<OutboundDraftRow>(
    `
    UPDATE outbound_drafts
    SET status = 'SENT',
        edited_text = $2,
        approved_at = now(),
        sent_at = now(),
        send_attempt_count = send_attempt_count + 1,
        last_send_attempt_at = now(),
        last_send_error = NULL,
        next_send_after = NULL,
        dead_lettered_at = NULL,
        updated_at = now()
    WHERE id = $1 AND status = 'DRAFTED'
    RETURNING *
    `,
    [id, editedText],
  )
  return rows[0] ?? null
}

export const listPendingSend = async (
  pool: Pool,
  channel: string,
  accountId: string,
  limit = 20,
  userId?: string | null,
): Promise<PendingSendRow[]> => {
  const uid = userId?.trim()
  const userClause = uid ? ' AND d.user_id = $4 ' : ''
  const params: unknown[] = uid ? [channel, accountId, limit, uid] : [channel, accountId, limit]
  const { rows } = await pool.query<PendingSendRow>(
    `
    SELECT d.*, i.contact_id, i.room_id
    FROM outbound_drafts d
    LEFT JOIN inbound_messages i ON i.id = d.inbound_message_id
    WHERE d.status = 'APPROVED'
      AND d.sent_at IS NULL
      AND (d.next_send_after IS NULL OR d.next_send_after <= now())
      AND d.channel = $1
      AND d.account_id = $2
      ${userClause}
    ORDER BY approved_at ASC NULLS LAST, created_at ASC
    LIMIT $3
    `,
    params,
  )
  return rows
}

export const markOutboundSent = async (pool: Pool, id: string): Promise<OutboundDraftRow | null> => {
  const { rows } = await pool.query<OutboundDraftRow>(
    `
    UPDATE outbound_drafts
    SET status = 'SENT',
        sent_at = now(),
        send_attempt_count = send_attempt_count + 1,
        last_send_attempt_at = now(),
        last_send_error = NULL,
        next_send_after = NULL,
        dead_lettered_at = NULL,
        updated_at = now()
    WHERE id = $1 AND status = 'APPROVED' AND sent_at IS NULL
    RETURNING *
    `,
    [id],
  )
  return rows[0] ?? null
}

export const markOutboundSendFailed = async (
  pool: Pool,
  input: {
    id: string
    error: string
    maxAttempts?: number
    retryDelaySeconds?: number
  },
): Promise<OutboundDraftRow | null> => {
  const maxAttempts = Math.max(1, Math.trunc(input.maxAttempts ?? 3))
  const retryDelaySeconds = Math.max(1, Math.trunc(input.retryDelaySeconds ?? 60))
  const { rows } = await pool.query<OutboundDraftRow>(
    `
    UPDATE outbound_drafts
    SET status = CASE WHEN send_attempt_count + 1 >= $3 THEN 'FAILED' ELSE 'APPROVED' END,
        send_attempt_count = send_attempt_count + 1,
        last_send_attempt_at = now(),
        last_send_error = $2,
        next_send_after = CASE
          WHEN send_attempt_count + 1 >= $3 THEN NULL
          ELSE now() + ($4 * interval '1 second')
        END,
        dead_lettered_at = CASE WHEN send_attempt_count + 1 >= $3 THEN now() ELSE NULL END,
        updated_at = now()
    WHERE id = $1 AND status = 'APPROVED' AND sent_at IS NULL
    RETURNING *
    `,
    [input.id, input.error, maxAttempts, retryDelaySeconds],
  )
  return rows[0] ?? null
}

export const appendOutboxEvent = async (
  pool: Pool,
  topic: string,
  payload: Record<string, unknown>,
): Promise<void> => {
  await pool.query(`INSERT INTO outbox_events (topic, payload) VALUES ($1, $2::jsonb)`, [
    topic,
    JSON.stringify(payload),
  ])
}

const mapDelegationRow = (row: {
  id: string
  event_type: string
  user_id: string | null
  channel: string | null
  account_id: string | null
  thread_id: string | null
  policy_action: string | null
  confidence: number | null
  policy_rule_id: string | null
  draft_id: string | null
  inbound_message_id: string | null
  metadata: Record<string, unknown>
  created_at: Date
}): DelegationEventRow => ({
  id: String(row.id),
  event_type: row.event_type,
  user_id: row.user_id,
  channel: row.channel,
  account_id: row.account_id,
  thread_id: row.thread_id,
  policy_action: row.policy_action,
  confidence: row.confidence,
  policy_rule_id: row.policy_rule_id,
  draft_id: row.draft_id,
  inbound_message_id: row.inbound_message_id,
  metadata: row.metadata ?? {},
  created_at: row.created_at,
})

export const insertDelegationEvent = async (
  pool: Pool,
  input: {
    eventType: string
    userId?: string | null
    channel?: string | null
    accountId?: string | null
    threadId?: string | null
    policyAction?: string | null
    confidence?: number | null
    policyRuleId?: string | null
    draftId?: string | null
    inboundMessageId?: string | null
    metadata?: Record<string, unknown>
  },
): Promise<void> => {
  await pool.query(
    `
    INSERT INTO delegation_events (
      event_type, user_id, channel, account_id, thread_id, policy_action, confidence,
      policy_rule_id, draft_id, inbound_message_id, metadata
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
    `,
    [
      input.eventType,
      input.userId ?? null,
      input.channel ?? null,
      input.accountId ?? null,
      input.threadId ?? null,
      input.policyAction ?? null,
      input.confidence ?? null,
      input.policyRuleId ?? null,
      input.draftId ?? null,
      input.inboundMessageId ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  )
}

export const listDelegationEvents = async (pool: Pool, limit = 100): Promise<DelegationEventRow[]> => {
  const { rows } = await pool.query(
    `
    SELECT id, event_type, user_id, channel, account_id, thread_id, policy_action, confidence,
           policy_rule_id, draft_id, inbound_message_id, metadata, created_at
    FROM delegation_events
    ORDER BY created_at DESC
    LIMIT $1
    `,
    [limit],
  )
  return rows.map(r => mapDelegationRow(r as Parameters<typeof mapDelegationRow>[0]))
}

/** Tenant-scoped audit stream (omit rows with null user_id). */
export const listDelegationEventsForUser = async (
  pool: Pool,
  userId: string,
  limit = 100,
): Promise<DelegationEventRow[]> => {
  const cap = Math.min(500, Math.max(1, limit))
  const { rows } = await pool.query(
    `
    SELECT id, event_type, user_id, channel, account_id, thread_id, policy_action, confidence,
           policy_rule_id, draft_id, inbound_message_id, metadata, created_at
    FROM delegation_events
    WHERE user_id = $2
    ORDER BY created_at DESC
    LIMIT $1
    `,
    [cap, userId],
  )
  return rows.map(r => mapDelegationRow(r as Parameters<typeof mapDelegationRow>[0]))
}

export const draftHasEventType = async (
  pool: Pool,
  draftId: string,
  eventType: string,
): Promise<boolean> => {
  const { rows } = await pool.query<{ exists: boolean }>(
    `
    SELECT EXISTS(
      SELECT 1
      FROM delegation_events
      WHERE draft_id = $1 AND event_type = $2
    ) AS exists
    `,
    [draftId, eventType],
  )
  return Boolean(rows[0]?.exists)
}

const toIso = (d: Date) => d.toISOString()

/** Aggregates for GQM dashboards — see docs/measurement-system-GQM.md */
export const queryGqmRollup = async (
  pool: Pool,
  params: { userId?: string | null; since: Date; until: Date },
): Promise<GqmRollup> => {
  const { userId, since, until } = params
  const uid = userId ?? null

  const { rows: typeRows } = await pool.query<{ event_type: string; c: string }>(
    `
    SELECT event_type, COUNT(*)::text AS c
    FROM delegation_events
    WHERE created_at >= $1 AND created_at < $2
      AND ($3::text IS NULL OR user_id = $3)
    GROUP BY event_type
    `,
    [since, until, uid],
  )

  const eventCounts: Record<string, number> = {}
  for (const r of typeRows) {
    eventCounts[r.event_type] = Number(r.c)
  }

  const { rows: policyRows } = await pool.query<{ policy_action: string; c: string }>(
    `
    SELECT policy_action, COUNT(*)::text AS c
    FROM delegation_events
    WHERE event_type = 'policy.evaluated'
      AND created_at >= $1 AND created_at < $2
      AND ($3::text IS NULL OR user_id = $3)
    GROUP BY policy_action
    `,
    [since, until, uid],
  )

  const policyActionCounts: Record<string, number> = {}
  for (const r of policyRows) {
    if (r.policy_action) {
      policyActionCounts[r.policy_action] = Number(r.c)
    }
  }

  const asIs = eventCounts['draft.approved_as_is'] ?? 0
  const edited = eventCounts['draft.approved_with_edit'] ?? 0
  const autoQueued = eventCounts['draft.auto_queued'] ?? 0
  const autoSent = eventCounts['draft.auto_sent'] ?? 0
  const denom = asIs + edited
  const approvalWithoutEditRate = denom > 0 ? asIs / denom : null

  const { rows: activityRows } = await pool.query<{ active_users: string; active_threads: string }>(
    `
    SELECT
      COUNT(DISTINCT user_id)::text AS active_users,
      COUNT(DISTINCT thread_id)::text AS active_threads
    FROM delegation_events
    WHERE created_at >= $1 AND created_at < $2
      AND ($3::text IS NULL OR user_id = $3)
    `,
    [since, until, uid],
  )
  const activity = activityRows[0] ?? { active_users: '0', active_threads: '0' }
  const activeUsers = Number(activity.active_users)
  const activeThreads = Number(activity.active_threads)

  const { rows: latencyRows } = await pool.query<{
    avg_draft_latency_seconds: number | null
    avg_approval_latency_seconds: number | null
    avg_send_latency_seconds: number | null
    avg_resolution_seconds: number | null
  }>(
    `
    SELECT
      AVG(EXTRACT(EPOCH FROM (d.created_at - i.received_at))) AS avg_draft_latency_seconds,
      AVG(
        CASE
          WHEN d.approved_at IS NOT NULL THEN EXTRACT(EPOCH FROM (d.approved_at - d.created_at))
          ELSE NULL
        END
      ) AS avg_approval_latency_seconds,
      AVG(
        CASE
          WHEN d.sent_at IS NOT NULL AND d.approved_at IS NOT NULL
            THEN EXTRACT(EPOCH FROM (d.sent_at - d.approved_at))
          ELSE NULL
        END
      ) AS avg_send_latency_seconds,
      AVG(
        CASE
          WHEN d.sent_at IS NOT NULL THEN EXTRACT(EPOCH FROM (d.sent_at - i.received_at))
          ELSE NULL
        END
      ) AS avg_resolution_seconds
    FROM outbound_drafts d
    LEFT JOIN inbound_messages i ON i.id = d.inbound_message_id
    WHERE d.created_at >= $1 AND d.created_at < $2
      AND ($3::text IS NULL OR d.user_id = $3)
    `,
    [since, until, uid],
  )
  const latency = latencyRows[0] ?? {
    avg_draft_latency_seconds: null,
    avg_approval_latency_seconds: null,
    avg_send_latency_seconds: null,
    avg_resolution_seconds: null,
  }

  const { rows: identityRows } = await pool.query<{
    relationship_count: string
    high_risk_relationship_count: string
    auto_reply_enabled_count: string
    hard_constraint_count: string
    memory_chunk_count: string
  }>(
    `
    SELECT
      (SELECT COUNT(*)::text FROM relationship_graph rg WHERE ($1::text IS NULL OR rg.user_id = $1)) AS relationship_count,
      (SELECT COUNT(*)::text FROM relationship_graph rg WHERE rg.risk_level = 'high' AND ($1::text IS NULL OR rg.user_id = $1)) AS high_risk_relationship_count,
      (SELECT COUNT(*)::text FROM relationship_graph rg WHERE rg.auto_reply_enabled = true AND ($1::text IS NULL OR rg.user_id = $1)) AS auto_reply_enabled_count,
      (SELECT COUNT(*)::text FROM hard_constraints hc WHERE ($1::text IS NULL OR hc.user_id = $1)) AS hard_constraint_count,
      (SELECT COUNT(*)::text FROM memory_chunks mc WHERE ($1::text IS NULL OR mc.user_id = $1)) AS memory_chunk_count
    `,
    [uid],
  )
  const identity = identityRows[0] ?? {
    relationship_count: '0',
    high_risk_relationship_count: '0',
    auto_reply_enabled_count: '0',
    hard_constraint_count: '0',
    memory_chunk_count: '0',
  }

  const { rows: feedbackRows } = await pool.query<{
    avg_sounds_like_me_score: number | null
    sounds_like_me_count: string
    regret_count: string
    boundary_violation_count: string
  }>(
    `
    SELECT
      AVG(
        CASE
          WHEN event_type = 'feedback.sounds_like_me' AND metadata ? 'score'
            THEN (metadata->>'score')::double precision
          ELSE NULL
        END
      ) AS avg_sounds_like_me_score,
      SUM(CASE WHEN event_type = 'feedback.sounds_like_me' THEN 1 ELSE 0 END)::text AS sounds_like_me_count,
      SUM(CASE WHEN event_type = 'feedback.regret' THEN 1 ELSE 0 END)::text AS regret_count,
      SUM(CASE WHEN event_type = 'feedback.boundary_violation' THEN 1 ELSE 0 END)::text AS boundary_violation_count
    FROM delegation_events
    WHERE created_at >= $1 AND created_at < $2
      AND ($3::text IS NULL OR user_id = $3)
    `,
    [since, until, uid],
  )
  const feedback = feedbackRows[0] ?? {
    avg_sounds_like_me_score: null,
    sounds_like_me_count: '0',
    regret_count: '0',
    boundary_violation_count: '0',
  }
  const sent = eventCounts['outbound.sent'] ?? 0
  const regretRate = sent > 0 ? Number(feedback.regret_count) / sent : null
  const boundaryViolationRate = sent > 0 ? Number(feedback.boundary_violation_count) / sent : null

  const { rows: seriesRows } = await pool.query<{
    day: string
    inbound_enqueued: string
    assist_generated: string
    drafts_created: string
    auto_queued: string
    approved_as_is: string
    approved_with_edit: string
    sent: string
    auto_sent: string
    policy_review: string
    policy_block: string
    policy_auto_send: string
  }>(
    `
    SELECT
      to_char(created_at::date, 'YYYY-MM-DD') AS day,
      SUM(CASE WHEN event_type = 'inbound.enqueued' THEN 1 ELSE 0 END)::text AS inbound_enqueued,
      SUM(CASE WHEN event_type = 'assist.generated' THEN 1 ELSE 0 END)::text AS assist_generated,
      SUM(CASE WHEN event_type = 'draft.created' THEN 1 ELSE 0 END)::text AS drafts_created,
      SUM(CASE WHEN event_type = 'draft.auto_queued' THEN 1 ELSE 0 END)::text AS auto_queued,
      SUM(CASE WHEN event_type = 'draft.approved_as_is' THEN 1 ELSE 0 END)::text AS approved_as_is,
      SUM(CASE WHEN event_type = 'draft.approved_with_edit' THEN 1 ELSE 0 END)::text AS approved_with_edit,
      SUM(CASE WHEN event_type = 'outbound.sent' THEN 1 ELSE 0 END)::text AS sent,
      SUM(CASE WHEN event_type = 'draft.auto_sent' THEN 1 ELSE 0 END)::text AS auto_sent,
      SUM(CASE WHEN event_type = 'policy.evaluated' AND policy_action = 'REVIEW' THEN 1 ELSE 0 END)::text AS policy_review,
      SUM(CASE WHEN event_type = 'policy.evaluated' AND policy_action = 'BLOCK' THEN 1 ELSE 0 END)::text AS policy_block,
      SUM(CASE WHEN event_type = 'policy.evaluated' AND policy_action = 'AUTO_SEND' THEN 1 ELSE 0 END)::text AS policy_auto_send
    FROM delegation_events
    WHERE created_at >= $1 AND created_at < $2
      AND ($3::text IS NULL OR user_id = $3)
    GROUP BY created_at::date
    ORDER BY created_at::date ASC
    `,
    [since, until, uid],
  )
  const dailySeries = seriesRows.map(row => ({
    day: row.day,
    inboundEnqueued: Number(row.inbound_enqueued),
    assistGenerated: Number(row.assist_generated),
    draftsCreated: Number(row.drafts_created),
    autoQueued: Number(row.auto_queued),
    approvedAsIs: Number(row.approved_as_is),
    approvedWithEdit: Number(row.approved_with_edit),
    sent: Number(row.sent),
    autoSent: Number(row.auto_sent),
    policyReview: Number(row.policy_review),
    policyBlock: Number(row.policy_block),
    policyAutoSend: Number(row.policy_auto_send),
  }))

  const timeToValueRows = uid
    ? (
        await pool.query<{
          time_to_value_seconds: number | null
        }>(
          `
          WITH first_ingest AS (
            SELECT MIN(created_at) AS ts
            FROM delegation_events
            WHERE user_id = $1
              AND event_type IN ('ingest.completed', 'oauth.connected')
          ),
          first_draft AS (
            SELECT MIN(created_at) AS ts
            FROM delegation_events
            WHERE user_id = $1
              AND event_type = 'draft.created'
              AND created_at >= COALESCE((SELECT ts FROM first_ingest), '-infinity'::timestamptz)
          )
          SELECT
            CASE
              WHEN (SELECT ts FROM first_ingest) IS NULL OR (SELECT ts FROM first_draft) IS NULL THEN NULL
              ELSE EXTRACT(EPOCH FROM ((SELECT ts FROM first_draft) - (SELECT ts FROM first_ingest)))
            END AS time_to_value_seconds
          `,
          [uid],
        )
      ).rows
    : [{ time_to_value_seconds: null }]
  const timeToValueSeconds = timeToValueRows[0]?.time_to_value_seconds ?? null

  const inboundEnqueued = eventCounts['inbound.enqueued'] ?? 0
  const assistGenerated = eventCounts['assist.generated'] ?? 0
  const summariesGenerated = eventCounts['summary.generated'] ?? 0
  const draftsCreated = eventCounts['draft.created'] ?? 0
  const approvals = asIs + edited
  const rejected = eventCounts['draft.rejected'] ?? 0
  const humanSent = Math.max(0, sent - autoSent)
  const modeChanges = eventCounts['mode.changed'] ?? 0
  const trustRegressions = eventCounts['trust.regression'] ?? 0
  const assistedOrDelegatedRate = inboundEnqueued > 0 ? (assistGenerated + draftsCreated) / inboundEnqueued : null

  const policyTotal =
    (policyActionCounts.AUTO_SEND ?? 0) +
    (policyActionCounts.REVIEW ?? 0) +
    (policyActionCounts.BLOCK ?? 0)
  const autoEligibleRate = policyTotal > 0 ? (policyActionCounts.AUTO_SEND ?? 0) / policyTotal : null
  const reviewRate = policyTotal > 0 ? (policyActionCounts.REVIEW ?? 0) / policyTotal : null
  const blockRate = policyTotal > 0 ? (policyActionCounts.BLOCK ?? 0) / policyTotal : null

  const oauthConnections = eventCounts['oauth.connected'] ?? 0
  const ingestsCompleted = eventCounts['ingest.completed'] ?? 0

  return {
    since: toIso(since),
    until: toIso(until),
    userId: uid,
    eventCounts,
    policyActionCounts,
    approvalWithoutEditRate,
    asIsApprovals: asIs,
    editedApprovals: edited,
    avgSoundsLikeMeScore: feedback.avg_sounds_like_me_score,
    regretRate,
    boundaryViolationRate,
    overview: {
      activeUsers,
      activeThreads,
      inboundEnqueued,
      assistGenerated,
      summariesGenerated,
      draftsCreated,
      autoQueued,
      approvals,
      sent,
      autoSent,
      humanSent,
      rejected,
      modeChanges,
      trustRegressions,
      assistedOrDelegatedRate,
    },
    trust: {
      autoEligibleRate,
      reviewRate,
      blockRate,
      approvalWithoutEditRate,
      avgSoundsLikeMeScore: feedback.avg_sounds_like_me_score,
      regretRate,
      boundaryViolationRate,
    },
    productivity: {
      avgDraftLatencySeconds: latency.avg_draft_latency_seconds,
      avgApprovalLatencySeconds: latency.avg_approval_latency_seconds,
      avgSendLatencySeconds: latency.avg_send_latency_seconds,
      avgResolutionSeconds: latency.avg_resolution_seconds,
      timeToValueSeconds,
    },
    identity: {
      relationshipCount: Number(identity.relationship_count),
      highRiskRelationshipCount: Number(identity.high_risk_relationship_count),
      autoReplyEnabledCount: Number(identity.auto_reply_enabled_count),
      hardConstraintCount: Number(identity.hard_constraint_count),
      memoryChunkCount: Number(identity.memory_chunk_count),
      oauthConnections,
      ingestsCompleted,
    },
    coordination: {
      negotiationTurns: eventCounts['negotiation.turn'] ?? 0,
      a2aProposals: eventCounts['a2a.proposal'] ?? 0,
      a2aResponses: eventCounts['a2a.response'] ?? 0,
      doerStarted: eventCounts['doer.started'] ?? 0,
      doerCompleted: eventCounts['doer.completed'] ?? 0,
      doerFailed: eventCounts['doer.failed'] ?? 0,
    },
    dailySeries,
  }
}

export const selectReplyOptionAndApprove = async (
  pool: Pool,
  draftId: string,
  optionIndex: number,
): Promise<OutboundDraftRow | null> => {
  const draft = await getOutboundDraft(pool, draftId)
  if (!draft || draft.status !== 'DRAFTED') {
    return null
  }
  const options = draft.reply_options
  if (!options || !Array.isArray(options) || optionIndex < 0 || optionIndex >= options.length) {
    return null
  }
  const opt = options[optionIndex]!
  const text = typeof opt?.text === 'string' ? opt.text : ''
  if (!text.trim()) {
    return null
  }
  const { rows } = await pool.query<OutboundDraftRow>(
    `
    UPDATE outbound_drafts
    SET status = 'APPROVED',
        edited_text = $2,
        approved_at = now(),
        updated_at = now()
    WHERE id = $1 AND status = 'DRAFTED'
    RETURNING *
    `,
    [draftId, text],
  )
  return rows[0] ?? null
}

export const selectReplyOptionApproveAndMarkSent = async (
  pool: Pool,
  draftId: string,
  optionIndex: number,
): Promise<OutboundDraftRow | null> => {
  const draft = await getOutboundDraft(pool, draftId)
  if (!draft || draft.status !== 'DRAFTED') {
    return null
  }
  const options = draft.reply_options
  if (!options || !Array.isArray(options) || optionIndex < 0 || optionIndex >= options.length) {
    return null
  }
  const opt = options[optionIndex]!
  const text = typeof opt?.text === 'string' ? opt.text : ''
  if (!text.trim()) {
    return null
  }
  const { rows } = await pool.query<OutboundDraftRow>(
    `
    UPDATE outbound_drafts
    SET status = 'SENT',
        edited_text = $2,
        approved_at = now(),
        sent_at = now(),
        send_attempt_count = send_attempt_count + 1,
        last_send_attempt_at = now(),
        last_send_error = NULL,
        next_send_after = NULL,
        dead_lettered_at = NULL,
        updated_at = now()
    WHERE id = $1 AND status = 'DRAFTED'
    RETURNING *
    `,
    [draftId, text],
  )
  return rows[0] ?? null
}

export type OAuthProvider = 'google_gmail' | 'slack'

export interface OAuthAccountRow {
  id: string
  user_id: string
  provider: OAuthProvider
  access_token: string
  refresh_token: string | null
  expires_at: Date | null
  scope: string | null
  external_subject: string | null
  created_at: Date
  updated_at: Date
}

export const upsertOAuthAccount = async (
  pool: Pool,
  input: {
    userId: string
    provider: OAuthProvider
    accessToken: string
    refreshToken?: string | null
    expiresAt?: Date | null
    scope?: string | null
    externalSubject?: string | null
  },
): Promise<void> => {
  await pool.query(
    `
    INSERT INTO oauth_accounts (user_id, provider, access_token, refresh_token, expires_at, scope, external_subject)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (user_id, provider) DO UPDATE SET
      access_token = EXCLUDED.access_token,
      refresh_token = COALESCE(EXCLUDED.refresh_token, oauth_accounts.refresh_token),
      expires_at = EXCLUDED.expires_at,
      scope = EXCLUDED.scope,
      external_subject = COALESCE(EXCLUDED.external_subject, oauth_accounts.external_subject),
      updated_at = now()
    `,
    [
      input.userId,
      input.provider,
      input.accessToken,
      input.refreshToken ?? null,
      input.expiresAt ?? null,
      input.scope ?? null,
      input.externalSubject ?? null,
    ],
  )
}

export const getOAuthAccount = async (
  pool: Pool,
  userId: string,
  provider: OAuthProvider,
): Promise<OAuthAccountRow | null> => {
  const { rows } = await pool.query<OAuthAccountRow>(
    `SELECT * FROM oauth_accounts WHERE user_id = $1 AND provider = $2`,
    [userId, provider],
  )
  return rows[0] ?? null
}

export const insertMemoryChunks = async (
  pool: Pool,
  input: { userId: string; threadId?: string | null; contents: string[] },
): Promise<number> => {
  let n = 0
  for (const content of input.contents) {
    const t = content.trim()
    if (!t) {
      continue
    }
    await pool.query(
      `INSERT INTO memory_chunks (user_id, thread_id, content) VALUES ($1, $2, $3)`,
      [input.userId, input.threadId ?? null, t],
    )
    n++
  }
  return n
}

export type MemoryChunkRow = {
  id: string
  thread_id: string | null
  content: string
  created_at: Date
}

/**
 * PRD: durable chunked memory (desktop ingest, OCR, summaries). Listed for operator review;
 * same rows feed FTS (`GET /mirachat/search`) and thread transcript union in PostgresMemoryService.
 */
export const listMemoryChunksForUser = async (
  pool: Pool,
  input: { userId: string; threadId?: string | null; limit?: number },
): Promise<MemoryChunkRow[]> => {
  const cap = Math.min(200, Math.max(1, input.limit ?? 80))
  const tid = input.threadId?.trim()
  if (tid) {
    const { rows } = await pool.query<MemoryChunkRow>(
      `
      SELECT id, thread_id, content, created_at
      FROM memory_chunks
      WHERE user_id = $1 AND thread_id = $2
      ORDER BY created_at DESC
      LIMIT $3
      `,
      [input.userId, tid, cap],
    )
    return rows
  }
  const { rows } = await pool.query<MemoryChunkRow>(
    `
    SELECT id, thread_id, content, created_at
    FROM memory_chunks
    WHERE user_id = $1
    ORDER BY created_at DESC
    LIMIT $2
    `,
    [input.userId, cap],
  )
  return rows
}

export interface A2aEnvelopeRow {
  id: string
  protocol_version: string
  from_user_id: string
  to_user_id: string
  thread_ref: string | null
  intent: string
  payload: Record<string, unknown>
  response_payload: Record<string, unknown> | null
  status: string
  created_at: Date
  updated_at: Date
}

export const insertA2aEnvelope = async (
  pool: Pool,
  input: {
    fromUserId: string
    toUserId: string
    threadRef?: string | null
    intent: string
    payload?: Record<string, unknown>
  },
): Promise<string> => {
  const { rows } = await pool.query<{ id: string }>(
    `
    INSERT INTO a2a_envelopes (from_user_id, to_user_id, thread_ref, intent, payload)
    VALUES ($1, $2, $3, $4, $5::jsonb)
    RETURNING id
    `,
    [
      input.fromUserId,
      input.toUserId,
      input.threadRef ?? null,
      input.intent,
      JSON.stringify(input.payload ?? {}),
    ],
  )
  return rows[0]!.id
}

export const respondA2aEnvelope = async (
  pool: Pool,
  id: string,
  input: { status: 'accepted' | 'rejected'; responsePayload?: Record<string, unknown> },
): Promise<A2aEnvelopeRow | null> => {
  const { rows } = await pool.query<A2aEnvelopeRow>(
    `
    UPDATE a2a_envelopes
    SET status = $2,
        response_payload = $3::jsonb,
        updated_at = now()
    WHERE id = $1 AND status = 'proposed'
    RETURNING *
    `,
    [id, input.status, JSON.stringify(input.responsePayload ?? {})],
  )
  return rows[0] ?? null
}

export const listA2aEnvelopesForUser = async (
  pool: Pool,
  userId: string,
  role: 'to' | 'from',
  limit = 50,
): Promise<A2aEnvelopeRow[]> => {
  const sql =
    role === 'to'
      ? `SELECT * FROM a2a_envelopes WHERE to_user_id = $1 ORDER BY created_at DESC LIMIT $2`
      : `SELECT * FROM a2a_envelopes WHERE from_user_id = $1 ORDER BY created_at DESC LIMIT $2`
  const { rows } = await pool.query<A2aEnvelopeRow>(sql, [userId, limit])
  return rows
}

export interface ThreadSummaryRow {
  threadId: string
  lastAt: string
  preview: string | null
  messageCount: number
}

export const listThreadSummariesForUser = async (
  pool: Pool,
  userId: string,
  limit = 50,
): Promise<ThreadSummaryRow[]> => {
  const cap = Math.min(Math.max(1, limit), 200)
  const { rows } = await pool.query<{
    thread_id: string
    last_at: Date
    preview: string | null
    message_count: string
  }>(
    `
    SELECT
      ranked.thread_id,
      ranked.last_at,
      ranked.preview,
      ranked.message_count
    FROM (
      SELECT
        activity.thread_id,
        MAX(activity.ts) AS last_at,
        (
          ARRAY_REMOVE(
            ARRAY_AGG(
              CASE WHEN activity.preview IS NOT NULL THEN activity.preview ELSE NULL END
              ORDER BY activity.ts DESC
            ),
            NULL
          )
        )[1] AS preview,
        COUNT(*)::text AS message_count
      FROM (
        SELECT
          im.thread_id,
          im.received_at AS ts,
          LEFT(im.raw_text, 160) AS preview
        FROM inbound_messages im
        WHERE im.user_id = $1
        UNION ALL
        SELECT
          od.thread_id,
          COALESCE(od.sent_at, od.updated_at, od.created_at) AS ts,
          LEFT(COALESCE(NULLIF(trim(od.edited_text), ''), od.generated_text), 160) AS preview
        FROM outbound_drafts od
        WHERE od.user_id = $1
      ) activity
      GROUP BY activity.thread_id
    ) ranked
    ORDER BY ranked.last_at DESC
    LIMIT $2
    `,
    [userId, cap],
  )
  return rows.map(row => ({
    threadId: row.thread_id,
    lastAt: row.last_at.toISOString(),
    preview: row.preview,
    messageCount: Number(row.message_count),
  }))
}

export const listThreadSummariesForSession = async (
  pool: Pool,
  input: {
    userId: string
    channel: string
    accountId: string
    limit?: number
  },
): Promise<ThreadSummaryRow[]> => {
  const cap = Math.min(Math.max(1, input.limit ?? 50), 200)
  const { rows } = await pool.query<{
    thread_id: string
    last_at: Date
    preview: string | null
    message_count: string
  }>(
    `
    SELECT
      ranked.thread_id,
      ranked.last_at,
      ranked.preview,
      ranked.message_count
    FROM (
      SELECT
        activity.thread_id,
        MAX(activity.ts) AS last_at,
        (
          ARRAY_REMOVE(
            ARRAY_AGG(
              CASE WHEN activity.preview IS NOT NULL THEN activity.preview ELSE NULL END
              ORDER BY activity.ts DESC
            ),
            NULL
          )
        )[1] AS preview,
        COUNT(*)::text AS message_count
      FROM (
        SELECT
          im.thread_id,
          im.received_at AS ts,
          LEFT(im.raw_text, 160) AS preview
        FROM inbound_messages im
        WHERE im.user_id = $1
          AND im.channel = $2
          AND im.account_id = $3
        UNION ALL
        SELECT
          od.thread_id,
          COALESCE(od.sent_at, od.updated_at, od.created_at) AS ts,
          LEFT(COALESCE(NULLIF(trim(od.edited_text), ''), od.generated_text), 160) AS preview
        FROM outbound_drafts od
        WHERE od.user_id = $1
          AND od.channel = $2
          AND od.account_id = $3
      ) activity
      GROUP BY activity.thread_id
    ) ranked
    ORDER BY ranked.last_at DESC
    LIMIT $4
    `,
    [input.userId, input.channel, input.accountId, cap],
  )
  return rows.map(row => ({
    threadId: row.thread_id,
    lastAt: row.last_at.toISOString(),
    preview: row.preview,
    messageCount: Number(row.message_count),
  }))
}
