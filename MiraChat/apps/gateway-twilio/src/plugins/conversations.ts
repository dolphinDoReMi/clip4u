import type { TwilioGatewayConfig } from '../config.js'
import type { TwilioChannel, TwilioTransportPlugin } from '../plugin-types.js'
import { createAuthCandidates, shouldFallbackToAccountAuth } from '../twilio-auth.js'

const normalizeConversationSid = (threadId: string): string => {
  const trimmed = threadId.trim()
  if (trimmed.startsWith('conversation:')) {
    return trimmed.slice('conversation:'.length)
  }
  return trimmed
}

const senderForChannel = (config: TwilioGatewayConfig, channel: TwilioChannel): string =>
  channel === 'twilio_whatsapp' ? config.whatsappFrom : config.smsFrom

export const createConversationsPlugin = (config: TwilioGatewayConfig): TwilioTransportPlugin => {
  const authCandidates = createAuthCandidates(config)

  return {
    id: 'conversations',
    supports: channel => channel === 'twilio_sms' || channel === 'twilio_whatsapp',
    isConfigured: () => authCandidates.length > 0,
    health: () => ({
      type: 'conversations',
      configured: authCandidates.length > 0,
      authModes: authCandidates.map(candidate => candidate.label),
    }),
    async send(item) {
      if (!authCandidates.length) {
        throw new Error('Twilio Conversations client not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN)')
      }

      const conversationSid = normalizeConversationSid(item.threadId)
      if (!/^CH[0-9a-fA-F]{32}$/.test(conversationSid)) {
        throw new Error('Twilio Conversations plugin expects threadId to be a Conversation SID (CH...)')
      }

      const author = senderForChannel(config, item.channel) || `mirachat:${item.channel}`
      let lastError: unknown
      for (const [index, candidate] of authCandidates.entries()) {
        try {
          await candidate.client.conversations.v1.conversations(conversationSid).messages.create({
            author,
            body: item.text,
          })
          return
        } catch (err) {
          lastError = err
          if (shouldFallbackToAccountAuth(authCandidates, err, index)) {
            console.warn('Twilio Conversations API key auth rejected; retrying with account SID + auth token')
            continue
          }
          throw err
        }
      }

      throw lastError instanceof Error ? lastError : new Error('Twilio Conversations send failed')
    },
  }
}
