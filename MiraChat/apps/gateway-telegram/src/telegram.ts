import type { Channel } from '@delegate-ai/adapter-types'

export interface TelegramUser {
  id: number
  is_bot?: boolean
  username?: string
  first_name?: string
}

export interface TelegramChat {
  id: number
  type: 'private' | 'group' | 'supergroup' | 'channel'
  title?: string
  username?: string
}

export interface TelegramEntity {
  type: string
  offset: number
  length: number
  user?: TelegramUser
}

export interface TelegramMessage {
  message_id: number
  text?: string
  caption?: string
  from?: TelegramUser
  chat: TelegramChat
  entities?: TelegramEntity[]
  caption_entities?: TelegramEntity[]
}

export interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage
  edited_message?: TelegramMessage
  channel_post?: TelegramMessage
  edited_channel_post?: TelegramMessage
}

export interface NormalizedTelegramInbound {
  channel: Channel
  contactId: string
  roomId: string | null
  threadId: string
  text: string
  senderId: string
  messageId: string
  threadType: 'dm' | 'group'
  mentions?: string[]
}

const mentionIdsFromEntities = (text: string, entities?: TelegramEntity[]): string[] | undefined => {
  if (!entities?.length) {
    return undefined
  }

  const mentions = entities
    .map(entity => {
      if (entity.type === 'text_mention' && entity.user?.id != null) {
        return String(entity.user.id)
      }
      if (entity.type === 'mention') {
        return text.slice(entity.offset, entity.offset + entity.length).trim()
      }
      return ''
    })
    .filter(Boolean)

  return mentions.length ? mentions : undefined
}

export const extractTelegramMessage = (update: TelegramUpdate): TelegramMessage | null =>
  update.message ?? update.edited_message ?? update.channel_post ?? update.edited_channel_post ?? null

export const isTelegramWebhookAuthorized = (
  headerValue: string | undefined,
  expectedSecret: string,
): boolean => {
  if (!expectedSecret) {
    return true
  }
  return headerValue === expectedSecret
}

export const normalizeTelegramUpdate = (update: TelegramUpdate): NormalizedTelegramInbound | null => {
  const message = extractTelegramMessage(update)
  if (!message) {
    return null
  }

  const text = typeof message.text === 'string' && message.text.trim()
    ? message.text.trim()
    : typeof message.caption === 'string' && message.caption.trim()
      ? message.caption.trim()
      : ''

  if (!text) {
    return null
  }

  const threadId = String(message.chat.id)
  const senderId = String(message.from?.id ?? message.chat.id)
  const threadType = message.chat.type === 'private' ? 'dm' : 'group'
  const entities = message.entities ?? message.caption_entities

  return {
    channel: 'telegram',
    contactId: senderId,
    roomId: threadType === 'group' ? threadId : null,
    threadId,
    text,
    senderId,
    messageId: `tg-${update.update_id}-${message.message_id}`,
    threadType,
    mentions: mentionIdsFromEntities(text, entities),
  }
}
