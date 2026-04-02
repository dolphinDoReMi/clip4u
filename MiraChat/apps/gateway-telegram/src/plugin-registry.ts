import { createPluginRegistry } from '@delegate-ai/gateway-runtime'
import type { Telegraf } from 'telegraf'
import { createTelegramBotApiPlugin } from './plugins/bot-api.js'
import type { TelegramChannel, TelegramTransportPlugin } from './plugin-types.js'

export const createTelegramPluginRegistry = (bot: Telegraf, botToken: string) =>
  createPluginRegistry<TelegramChannel, TelegramTransportPlugin>({
    routing: { telegram: 'bot-api' },
    factories: {
      'bot-api': () => createTelegramBotApiPlugin(bot, botToken),
    },
  })
