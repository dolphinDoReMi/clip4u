import twilio from 'twilio'
import type { TwilioGatewayConfig } from '../config.js'
import type { TwilioChannel, TwilioTransportPlugin } from '../plugin-types.js'
import { createAuthCandidates, shouldFallbackToAccountAuth } from '../twilio-auth.js'

const normalizeAddress = (value: string): string => value.trim().toLowerCase()

const senderForChannel = (config: TwilioGatewayConfig, channel: TwilioChannel): string =>
  channel === 'twilio_whatsapp' ? config.whatsappFrom : config.smsFrom

export const createProgrammableMessagingPlugin = (
  config: TwilioGatewayConfig,
): TwilioTransportPlugin => {
  const authCandidates = createAuthCandidates(config)

  return {
    id: 'programmable-messaging',
    supports: channel => channel === 'twilio_sms' || channel === 'twilio_whatsapp',
    isConfigured: () => authCandidates.length > 0,
    health: () => ({
      type: 'programmable-messaging',
      configured: authCandidates.length > 0,
      authModes: authCandidates.map(candidate => candidate.label),
      senders: {
        twilio_sms: Boolean(config.smsFrom),
        twilio_whatsapp: Boolean(config.whatsappFrom),
      },
    }),
    async send(item) {
      if (!authCandidates.length) {
        throw new Error('Twilio client not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN)')
      }

      const from = senderForChannel(config, item.channel)
      if (!from) {
        throw new Error(
          item.channel === 'twilio_whatsapp'
            ? 'Set TWILIO_WHATSAPP_FROM (e.g. whatsapp:+15551234567)'
            : 'Set TWILIO_SMS_FROM (E.164)',
        )
      }

      if (normalizeAddress(from) === normalizeAddress(item.threadId)) {
        throw new Error(`Twilio destination matches sender for ${item.channel}; use a distinct recipient address`)
      }

      let lastError: unknown
      for (const [index, candidate] of authCandidates.entries()) {
        try {
          await candidate.client.messages.create({
            from,
            to: item.threadId,
            body: item.text,
          })
          return
        } catch (err) {
          lastError = err
          if (shouldFallbackToAccountAuth(authCandidates, err, index)) {
            console.warn('Twilio API key auth rejected; retrying with account SID + auth token')
            continue
          }
          throw err
        }
      }

      throw lastError instanceof Error ? lastError : new Error('Twilio send failed')
    },
  }
}
