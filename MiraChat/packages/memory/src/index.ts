import type { MemoryService, MessageEvent, OutboundCommand, StoredMessage } from '@delegate-ai/adapter-types'

const scoreMatch = (content: string, query: string): number => {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length >= 2)
  return terms.reduce((score, term) => score + (content.toLowerCase().includes(term) ? 1 : 0), 0)
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

  async searchMessages(userId: string, query: string, limit = 80): Promise<StoredMessage[]> {
    return this.messages
      .filter(message => message.userId === userId)
      .map(message => ({ message, score: scoreMatch(message.content, query) }))
      .filter(entry => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(entry => entry.message)
  }
}
