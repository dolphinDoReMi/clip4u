import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TwilioGatewayConfig } from '../apps/gateway-twilio/src/config.ts'

const programmableCreate = vi.fn()
const conversationsCreate = vi.fn()

vi.mock('twilio', () => {
  const twilioFn = ((sidOrKey: string) => {
    if (sidOrKey.startsWith('SK')) {
      return {
        messages: { create: programmableCreate },
        conversations: { v1: { conversations: () => ({ messages: { create: conversationsCreate } }) } },
      }
    }
    return {
      messages: { create: conversationsCreate },
      conversations: { v1: { conversations: () => ({ messages: { create: conversationsCreate } }) } },
    }
  }) as unknown as {
    (...args: unknown[]): unknown
    twiml: { MessagingResponse: new () => { toString(): string } }
    validateRequest: () => boolean
  }

  twilioFn.twiml = {
    MessagingResponse: class {
      toString(): string {
        return '<Response/>'
      }
    },
  }
  twilioFn.validateRequest = () => true
  return { default: twilioFn }
})

const { createProgrammableMessagingPlugin } = await import('../apps/gateway-twilio/src/plugins/programmable-messaging.ts')
const { createConversationsPlugin } = await import('../apps/gateway-twilio/src/plugins/conversations.ts')
const { createTwilioPluginRegistry } = await import('../apps/gateway-twilio/src/plugin-registry.ts')

const baseConfig: TwilioGatewayConfig = {
  accountSid: 'AC123',
  authToken: 'auth-token',
  apiKeySid: 'SK123',
  apiKeySecret: 'api-secret',
  apiBase: 'http://127.0.0.1:4000',
  mirachatUserId: 'demo-user',
  smsFrom: '+15551234567',
  whatsappFrom: 'whatsapp:+15551234567',
  webhookBase: '',
  skipSig: true,
  port: 4010,
  pollMs: 5000,
  pluginByChannel: {
    twilio_sms: 'programmable-messaging',
    twilio_whatsapp: 'programmable-messaging',
  },
}

describe('gateway-twilio plugins', () => {
  beforeEach(() => {
    programmableCreate.mockReset()
    conversationsCreate.mockReset()
  })

  it('routes channels through the configured plugin registry', () => {
    const registry = createTwilioPluginRegistry({
      ...baseConfig,
      pluginByChannel: {
        twilio_sms: 'programmable-messaging',
        twilio_whatsapp: 'conversations',
      },
    })

    expect(registry.resolve('twilio_sms').id).toBe('programmable-messaging')
    expect(registry.resolve('twilio_whatsapp').id).toBe('conversations')
  })

  it('prevents self-send in programmable messaging before reaching Twilio', async () => {
    const plugin = createProgrammableMessagingPlugin(baseConfig)

    await expect(
      plugin.send({
        channel: 'twilio_whatsapp',
        threadId: 'whatsapp:+15551234567',
        text: 'hello',
      }),
    ).rejects.toThrow(/destination matches sender/i)

    expect(programmableCreate).not.toHaveBeenCalled()
    expect(conversationsCreate).not.toHaveBeenCalled()
  })

  it('falls back from api-key auth to account auth for programmable messaging', async () => {
    programmableCreate.mockRejectedValueOnce({
      status: 401,
      code: 20003,
      message: 'Authenticate',
      moreInfo: 'https://twilio.test/errors/20003',
    })
    conversationsCreate.mockResolvedValueOnce({ sid: 'SM123' })
    const plugin = createProgrammableMessagingPlugin({
      ...baseConfig,
      whatsappFrom: 'whatsapp:+15550000000',
    })

    await plugin.send({
      channel: 'twilio_whatsapp',
      threadId: 'whatsapp:+15550000001',
      text: 'hello',
    })

    expect(programmableCreate).toHaveBeenCalledTimes(1)
    expect(conversationsCreate).toHaveBeenCalledTimes(1)
  })

  it('rejects invalid conversation thread ids before network calls', async () => {
    const plugin = createConversationsPlugin(baseConfig)

    await expect(
      plugin.send({
        channel: 'twilio_sms',
        threadId: '+15550000000',
        text: 'hello',
      }),
    ).rejects.toThrow(/Conversation SID/i)

    expect(conversationsCreate).not.toHaveBeenCalled()
  })
})
