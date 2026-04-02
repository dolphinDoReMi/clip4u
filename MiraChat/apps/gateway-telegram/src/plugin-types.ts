import type { TransportPlugin } from '@delegate-ai/gateway-runtime'

export const telegramChannels = ['telegram'] as const

export type TelegramChannel = (typeof telegramChannels)[number]

export type TelegramPendingSend = {
  threadId: string
  text: string
  channel: TelegramChannel
}

export type TelegramTransportPlugin = TransportPlugin<TelegramChannel, TelegramPendingSend>
