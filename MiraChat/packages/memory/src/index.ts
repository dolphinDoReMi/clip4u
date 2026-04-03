import type {
  MemorySearchOptions,
  MemoryService,
  MessageEvent,
  OutboundCommand,
  StoredMessage,
  StoredMessageSearchSource,
} from '@delegate-ai/adapter-types'

const searchTerms = (query: string): string[] =>
  query
    .toLowerCase()
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length >= 2)

const scoreMatch = (content: string, terms: string[]): number =>
  terms.reduce((score, term) => score + (content.toLowerCase().includes(term) ? 1 : 0), 0)

const buildSearchSnippet = (content: string, terms: string[], max = 240): string => {
  const text = content || ''
  if (!text) return ''
  const lower = text.toLowerCase()
  let bestIdx = -1
  let bestLen = 0
  for (const t of terms) {
    const i = lower.indexOf(t)
    if (i >= 0 && (bestIdx < 0 || i < bestIdx)) {
      bestIdx = i
      bestLen = t.length
    }
  }
  if (bestIdx < 0) {
    return text.length <= max ? text : `${text.slice(0, max - 1)}…`
  }
  const pad = 90
  const start = Math.max(0, bestIdx - pad)
  const end = Math.min(text.length, bestIdx + bestLen + pad)
  let s = text.slice(start, end)
  if (start > 0) s = `…${s}`
  if (end < text.length) s = `${s}…`
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

export class InMemoryMemoryService implements MemoryService {
  private readonly messages: StoredMessage[] = []

  async recordIncoming(event: MessageEvent): Promise<void> {
    this.messages.push({
      id: event.messageId,
      channel: event.channel,
      userId: event.userId,
      senderId: event.senderId,
      threadId: event.threadId,
      direction: 'inbound',
      content: event.text,
      timestamp: event.timestamp,
    })
  }

  async recordOutgoing(command: OutboundCommand): Promise<void> {
    this.messages.push({
      id: `out-${Date.now()}`,
      channel: command.channel,
      userId: command.userId,
      senderId: command.userId,
      threadId: command.threadId,
      direction: 'outbound',
      content: command.text,
      timestamp: Date.now(),
    })
  }

  async getRecentMessages(threadId: string, limit = 5000, _userId?: string): Promise<StoredMessage[]> {
    const threadMsgs = this.messages.filter(message => message.threadId === threadId)
    return threadMsgs.slice(-Math.min(limit, 20000))
  }

  async searchMessages(
    userId: string,
    query: string,
    limit = 80,
    options?: MemorySearchOptions,
  ): Promise<StoredMessage[]> {
    const terms = searchTerms(query)
    if (terms.length === 0) return []
    const tid = options?.threadId?.trim()
    return this.messages
      .filter(message => message.userId === userId)
      .filter(message => !tid || message.threadId === tid)
      .map(message => ({
        message,
        score: scoreMatch(message.content, terms),
      }))
      .filter(entry => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(entry => {
        const m = entry.message
        const src: StoredMessageSearchSource = m.direction === 'outbound' ? 'outbound' : 'inbound'
        return {
          ...m,
          searchSnippet: buildSearchSnippet(m.content, terms),
          searchSource: src,
          searchRank: entry.score,
        }
      })
  }
}
