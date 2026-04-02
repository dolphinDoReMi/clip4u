import type { TransportPlugin } from '@delegate-ai/gateway-runtime'

export const twilioChannels = ['twilio_sms', 'twilio_whatsapp'] as const

export type TwilioChannel = (typeof twilioChannels)[number]

export type PendingSendItem = {
  id: string
  threadId: string
  text: string
  channel: string
}

export const isTwilioChannel = (value: string): value is TwilioChannel =>
  twilioChannels.some(channel => channel === value)

export type TwilioTransportPlugin = TransportPlugin<
  TwilioChannel,
  { threadId: string; text: string; channel: TwilioChannel }
>
