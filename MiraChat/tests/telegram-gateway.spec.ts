import { describe, it, expect } from 'vitest'
import {
  extractTelegramMessage,
  isTelegramWebhookAuthorized,
  normalizeTelegramUpdate,
  type TelegramUpdate,
} from '../apps/gateway-telegram/src/telegram.ts'

describe('gateway-telegram helpers', () => {
  it('normalizes private chat updates into MiraChat inbound shape', () => {
    const update: TelegramUpdate = {
      update_id: 101,
      message: {
        message_id: 12,
        text: 'Hello from Telegram',
        from: { id: 42, username: 'alice' },
        chat: { id: 42, type: 'private', username: 'alice' },
      },
    }

    expect(normalizeTelegramUpdate(update)).toEqual({
      channel: 'telegram',
      contactId: '42',
      roomId: null,
      threadId: '42',
      text: 'Hello from Telegram',
      senderId: '42',
      messageId: 'tg-101-12',
      threadType: 'dm',
      mentions: undefined,
    })
  })

  it('normalizes group mentions and room ids', () => {
    const update: TelegramUpdate = {
      update_id: 102,
      message: {
        message_id: 44,
        text: '@mira can you follow up today?',
        from: { id: 7, username: 'bob' },
        chat: { id: -100123, type: 'supergroup', title: 'Ops' },
        entities: [{ type: 'mention', offset: 0, length: 5 }],
      },
    }

    expect(normalizeTelegramUpdate(update)).toEqual({
      channel: 'telegram',
      contactId: '7',
      roomId: '-100123',
      threadId: '-100123',
      text: '@mira can you follow up today?',
      senderId: '7',
      messageId: 'tg-102-44',
      threadType: 'group',
      mentions: ['@mira'],
    })
  })

  it('ignores non-text payloads', () => {
    const update: TelegramUpdate = {
      update_id: 103,
      message: {
        message_id: 45,
        chat: { id: 99, type: 'private' },
      },
    }

    expect(normalizeTelegramUpdate(update)).toBeNull()
  })

  it('extracts edited messages when message is absent', () => {
    const update: TelegramUpdate = {
      update_id: 104,
      edited_message: {
        message_id: 50,
        text: 'edited copy',
        from: { id: 9 },
        chat: { id: 9, type: 'private' },
      },
    }

    expect(extractTelegramMessage(update)?.message_id).toBe(50)
  })

  it('validates optional webhook secrets', () => {
    expect(isTelegramWebhookAuthorized(undefined, '')).toBe(true)
    expect(isTelegramWebhookAuthorized('secret-a', 'secret-a')).toBe(true)
    expect(isTelegramWebhookAuthorized('secret-a', 'secret-b')).toBe(false)
  })
})
