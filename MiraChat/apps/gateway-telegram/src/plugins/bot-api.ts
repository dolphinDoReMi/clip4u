import type { Telegraf } from 'telegraf'
import type { TelegramTransportPlugin } from '../plugin-types.js'

export const createTelegramBotApiPlugin = (
  bot: Telegraf,
  botToken: string,
): TelegramTransportPlugin => ({
  id: 'bot-api',
  supports: channel => channel === 'telegram',
  isConfigured: () => Boolean(botToken),
  health: () => ({
    type: 'bot-api',
    configured: Boolean(botToken),
  }),
  send: async item => {
    await bot.telegram.sendMessage(item.threadId, item.text)
  },
})
