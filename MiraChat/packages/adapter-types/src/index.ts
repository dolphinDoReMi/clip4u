export type KnownChannel =
  | 'wechat'
  | 'wecom'
  | 'whatsapp'
  | 'telegram'
  | 'twilio_sms'
  | 'twilio_whatsapp'

// Keep channel ids open for future plugins while still documenting the known set.
export type Channel = KnownChannel | (string & {})
export type ThreadType = 'dm' | 'group'
export type Mode = 'assist' | 'approve' | 'auto'
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'edited'
export type PolicyAction = 'AUTO_SEND' | 'REVIEW' | 'BLOCK' | 'ESCALATE'
export type RiskLevel = 'low' | 'medium' | 'high'

export interface MessageEvent {
  channel: Channel
  accountId: string
  userId: string
  senderId: string
  threadId: string
  messageId: string
  text: string
  timestamp: number
  threadType: ThreadType
  mentions?: string[]
  rawRef?: unknown
}

export interface AssistRequest {
  userId: string
  prompt: string
  sourceEvent?: MessageEvent
}

export interface IdentityProfile {
  userId: string
  displayName: string
  tone: string
  styleGuide: string[]
  hardBoundaries: string[]
}

export interface RelationshipProfile {
  userId: string
  contactId: string
  role: string
  tone: string
  riskLevel: RiskLevel
  notes: string[]
}

/** Optional metadata when a row is returned from cross-thread / full-text search. */
export type StoredMessageSearchSource = 'inbound' | 'outbound' | 'memory'

export interface StoredMessage {
  id: string
  channel: Channel
  userId: string
  senderId: string
  threadId: string
  direction: 'inbound' | 'outbound'
  content: string
  timestamp: number
  /** Short excerpt centered on a query term (search API / memory recall). */
  searchSnippet?: string
  /** Which backing store matched (DM text, sent reply, or memory chunk e.g. desktop OCR / vision summary). */
  searchSource?: StoredMessageSearchSource
  /** Higher is more relevant (Postgres `ts_rank_cd` when FTS is used). */
  searchRank?: number
}

/** Options for `MemoryService.searchMessages` (full-text across stored bodies + memory chunks). */
export interface MemorySearchOptions {
  /** Restrict hits to one thread (sidebar “this chat only”). */
  threadId?: string
}

/** Postgres-backed structured recall (entities, timeline, narrative); optional on MemoryService. */
export interface StructuredMemoryRecall {
  internalSummary: string
  entityBullets: string
  eventBullets: string
}

export interface MemoryContext {
  /** Full thread history (newest slice, chronological): inbound/outbound plus same-thread memory_chunks when userId is passed to getRecentMessages. */
  recentMessages: StoredMessage[]
  /** Text search hits across all of this user’s stored messages (other threads, etc.). */
  searchMatches: StoredMessage[]
  /** Optional OpenRouter (or compatible) model notes — analysis only, not the outbound draft. */
  analysisAssist?: string | null
  /** Optional structured memory (OpenRouter enrichment + entity/event/narrative tables). */
  structuredRecall?: StructuredMemoryRecall | null
  /** Optional attended ledger (filtered facts from structured memory based on current context). */
  attendedRecall?: string | null
}

export interface ContextBundle {
  event: MessageEvent
  identity: IdentityProfile
  relationship: RelationshipProfile
  memory: MemoryContext
}

export interface DelegateDraft {
  id: string
  mode: Mode
  response: string
  confidence: number
  reasons: string[]
  memoryRefs: string[]
  createdAt: number
}

export interface PolicyDecision {
  action: PolicyAction
  reasons: string[]
}

export interface OutboundCommand {
  channel: Channel
  accountId: string
  userId: string
  threadId: string
  text: string
}

export interface ApprovalRecord {
  id: string
  event: MessageEvent
  draft: DelegateDraft
  status: ApprovalStatus
  createdAt: number
  updatedAt: number
  editedText?: string
}

export interface ChannelAdapter {
  readonly channel: Channel
  send(command: OutboundCommand): Promise<void>
}

export interface IdentityService {
  getIdentity(userId: string): Promise<IdentityProfile>
  getRelationship(userId: string, contactId: string): Promise<RelationshipProfile>
  upsertIdentity(profile: IdentityProfile): Promise<void>
  upsertRelationship(profile: RelationshipProfile): Promise<void>
}

export interface MemoryService {
  recordIncoming(event: MessageEvent): Promise<void>
  recordOutgoing(command: OutboundCommand): Promise<void>
  /** Thread transcript: returns up to `limit` newest rows in chronological order (messages + optional same-thread memory chunks when `userId` is set). */
  getRecentMessages(threadId: string, limit?: number, userId?: string): Promise<StoredMessage[]>
  /**
   * Full-history search for `userId`: inbound + sent outbound + `memory_chunks` (desktop ingest, OCR, vision summaries).
   * Postgres: `tsvector` + `plainto_tsquery` ranking; optional `threadId` scopes to one conversation.
   */
  searchMessages(
    userId: string,
    query: string,
    limit?: number,
    options?: MemorySearchOptions,
  ): Promise<StoredMessage[]>
  /**
   * Optional: structured recall for prompts (entities, recent timeline events, narrative summary).
   * Implemented by Postgres-backed services when memory enrichment migrations are applied.
   */
  getStructuredRecall?(userId: string, threadId: string): Promise<StructuredMemoryRecall | null>
}

export interface ApprovalStore {
  createApproval(record: Omit<ApprovalRecord, 'id' | 'createdAt' | 'updatedAt' | 'status'>): Promise<ApprovalRecord>
  listApprovals(): Promise<ApprovalRecord[]>
  getApproval(id: string): Promise<ApprovalRecord | undefined>
  approve(id: string): Promise<ApprovalRecord | undefined>
  reject(id: string): Promise<ApprovalRecord | undefined>
  edit(id: string, editedText: string): Promise<ApprovalRecord | undefined>
}

export interface PolicyEngine {
  evaluate(input: {
    event: MessageEvent
    draft: DelegateDraft
    relationship: RelationshipProfile
    attendedRecall?: string | null
  }): Promise<PolicyDecision>
}

export class AdapterRegistry {
  private readonly adapters = new Map<Channel, ChannelAdapter>()

  register(adapter: ChannelAdapter): void {
    this.adapters.set(adapter.channel, adapter)
  }

  get(channel: Channel): ChannelAdapter {
    const adapter = this.adapters.get(channel)
    if (!adapter) {
      throw new Error(`No adapter registered for channel: ${channel}`)
    }
    return adapter
  }

  async send(command: OutboundCommand): Promise<void> {
    await this.get(command.channel).send(command)
  }
}
