import { describe, it, expect, vi } from 'vitest'
import {
  buildNotifyTwiml,
  placeOutboundNotifyCall,
  resolveTwilioVoiceConfigFromEnv,
} from '@delegate-ai/twilio-voice-notify'

describe('@delegate-ai/twilio-voice-notify', () => {
  it('buildNotifyTwiml escapes XML and prefixes on_behalf disclosure', () => {
    const twiml = buildNotifyTwiml({
      to: '+1',
      message: 'Hello <world> & "team"',
      disclosureMode: 'on_behalf',
      callerName: 'Dennis',
    })
    expect(twiml).toContain('This is an automated call on behalf of Dennis.')
    expect(twiml).toContain('&lt;world&gt;')
    expect(twiml).toContain('&amp;')
    expect(twiml).toContain('&quot;team&quot;')
    expect(twiml).toMatch(/<Say[^>]*voice="alice"/)
  })

  it('buildNotifyTwiml neutral mode has no delegation prefix', () => {
    const twiml = buildNotifyTwiml({
      to: '+1',
      message: 'Reminder only.',
      disclosureMode: 'neutral',
    })
    expect(twiml).not.toContain('on behalf')
    expect(twiml).toContain('Reminder only.')
  })

  it('placeOutboundNotifyCall posts to Twilio and returns sid', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({ sid: 'CA123', status: 'queued' }),
    })) as unknown as typeof fetch

    const out = await placeOutboundNotifyCall(
      { accountSid: 'ACxxx', authToken: 'sekret', fromNumber: '+15550001111' },
      { to: '+15550002222', message: 'Test', disclosureMode: 'neutral' },
      fetchImpl,
    )

    expect(out.callSid).toBe('CA123')
    expect(out.status).toBe('queued')
    expect(fetchImpl).toHaveBeenCalledOnce()
    const [, init] = fetchImpl.mock.calls[0]!
    expect(init?.method).toBe('POST')
    const sentBody = String((init as RequestInit).body)
    expect(sentBody).toContain('To=%2B15550002222')
    expect(sentBody).toContain('Twiml=')
  })

  it('placeOutboundNotifyCall sends StatusCallback and Timeout when set on config', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      text: async () => JSON.stringify({ sid: 'CAcb', status: 'queued' }),
    })) as unknown as typeof fetch

    await placeOutboundNotifyCall(
      {
        accountSid: 'ACxxx',
        authToken: 'sekret',
        fromNumber: '+15550001111',
        statusCallbackUrl: 'https://example.com/voice-status',
        timeoutSeconds: 90,
      },
      { to: '+15550002222', message: 'Hi', disclosureMode: 'neutral' },
      fetchImpl,
    )

    const [, init] = fetchImpl.mock.calls[0]!
    const sentBody = String((init as RequestInit).body)
    expect(sentBody).toContain('StatusCallback=https%3A%2F%2Fexample.com%2Fvoice-status')
    expect(sentBody).toContain('StatusCallbackEvent=initiated')
    expect(sentBody).toContain('Timeout=90')
  })

  it('resolveTwilioVoiceConfigFromEnv falls back to TWILIO_SMS_FROM', () => {
    const keys = [
      'MIRACHAT_TWILIO_ACCOUNT_SID',
      'MIRACHAT_TWILIO_AUTH_TOKEN',
      'MIRACHAT_TWILIO_VOICE_FROM',
      'TWILIO_VOICE_FROM_NUMBER',
      'TWILIO_ACCOUNT_SID',
      'TWILIO_AUTH_TOKEN',
      'TWILIO_SMS_FROM',
      'TWILIO_WHATSAPP_FROM',
      'MIRACHAT_TWILIO_VOICE_STATUS_CALLBACK',
      'TWILIO_VOICE_STATUS_CALLBACK',
      'MIRACHAT_TWILIO_VOICE_RING_TIMEOUT',
      'TWILIO_VOICE_RING_TIMEOUT',
      'MIRACHAT_PUBLIC_BASE_URL',
      'MIRACHAT_API_PUBLIC_URL',
    ] as const
    const prev: Record<string, string | undefined> = {}
    for (const k of keys) {
      prev[k] = process.env[k]
    }
    try {
      delete process.env.MIRACHAT_TWILIO_ACCOUNT_SID
      delete process.env.MIRACHAT_TWILIO_AUTH_TOKEN
      delete process.env.MIRACHAT_TWILIO_VOICE_FROM
      delete process.env.TWILIO_VOICE_FROM_NUMBER
      delete process.env.MIRACHAT_PUBLIC_BASE_URL
      delete process.env.MIRACHAT_API_PUBLIC_URL
      process.env.TWILIO_ACCOUNT_SID = 'ACfallback'
      process.env.TWILIO_AUTH_TOKEN = 'token'
      process.env.TWILIO_SMS_FROM = '+15550009999'
      delete process.env.TWILIO_WHATSAPP_FROM
      expect(resolveTwilioVoiceConfigFromEnv()).toMatchObject({
        accountSid: 'ACfallback',
        authToken: 'token',
        fromNumber: '+15550009999',
      })
    } finally {
      for (const k of keys) {
        if (prev[k] === undefined) {
          delete process.env[k]
        } else {
          process.env[k] = prev[k]
        }
      }
    }
  })

  it('resolveTwilioVoiceConfigFromEnv falls back to TWILIO_WHATSAPP_FROM E.164', () => {
    const keys = [
      'MIRACHAT_TWILIO_ACCOUNT_SID',
      'MIRACHAT_TWILIO_AUTH_TOKEN',
      'MIRACHAT_TWILIO_VOICE_FROM',
      'TWILIO_VOICE_FROM_NUMBER',
      'TWILIO_ACCOUNT_SID',
      'TWILIO_AUTH_TOKEN',
      'TWILIO_SMS_FROM',
      'TWILIO_WHATSAPP_FROM',
      'MIRACHAT_TWILIO_VOICE_STATUS_CALLBACK',
      'TWILIO_VOICE_STATUS_CALLBACK',
      'MIRACHAT_TWILIO_VOICE_RING_TIMEOUT',
      'TWILIO_VOICE_RING_TIMEOUT',
      'MIRACHAT_PUBLIC_BASE_URL',
      'MIRACHAT_API_PUBLIC_URL',
    ] as const
    const prev: Record<string, string | undefined> = {}
    for (const k of keys) {
      prev[k] = process.env[k]
    }
    try {
      delete process.env.MIRACHAT_TWILIO_ACCOUNT_SID
      delete process.env.MIRACHAT_TWILIO_AUTH_TOKEN
      delete process.env.MIRACHAT_TWILIO_VOICE_FROM
      delete process.env.TWILIO_VOICE_FROM_NUMBER
      delete process.env.MIRACHAT_PUBLIC_BASE_URL
      delete process.env.MIRACHAT_API_PUBLIC_URL
      process.env.TWILIO_ACCOUNT_SID = 'ACwa'
      process.env.TWILIO_AUTH_TOKEN = 'token'
      delete process.env.TWILIO_SMS_FROM
      process.env.TWILIO_WHATSAPP_FROM = 'whatsapp:+15550008888'
      expect(resolveTwilioVoiceConfigFromEnv()).toMatchObject({
        accountSid: 'ACwa',
        authToken: 'token',
        fromNumber: '+15550008888',
      })
    } finally {
      for (const k of keys) {
        if (prev[k] === undefined) {
          delete process.env[k]
        } else {
          process.env[k] = prev[k]
        }
      }
    }
  })

  it('resolveTwilioVoiceConfigFromEnv derives StatusCallback from MIRACHAT_PUBLIC_BASE_URL', () => {
    const keys = [
      'MIRACHAT_TWILIO_ACCOUNT_SID',
      'MIRACHAT_TWILIO_AUTH_TOKEN',
      'MIRACHAT_TWILIO_VOICE_FROM',
      'TWILIO_VOICE_FROM_NUMBER',
      'TWILIO_ACCOUNT_SID',
      'TWILIO_AUTH_TOKEN',
      'TWILIO_SMS_FROM',
      'TWILIO_WHATSAPP_FROM',
      'MIRACHAT_TWILIO_VOICE_STATUS_CALLBACK',
      'TWILIO_VOICE_STATUS_CALLBACK',
      'MIRACHAT_TWILIO_VOICE_RING_TIMEOUT',
      'TWILIO_VOICE_RING_TIMEOUT',
      'MIRACHAT_PUBLIC_BASE_URL',
      'MIRACHAT_API_PUBLIC_URL',
    ] as const
    const prev: Record<string, string | undefined> = {}
    for (const k of keys) {
      prev[k] = process.env[k]
    }
    try {
      delete process.env.MIRACHAT_TWILIO_ACCOUNT_SID
      delete process.env.MIRACHAT_TWILIO_VOICE_FROM
      delete process.env.TWILIO_VOICE_FROM_NUMBER
      delete process.env.MIRACHAT_TWILIO_VOICE_STATUS_CALLBACK
      delete process.env.TWILIO_VOICE_STATUS_CALLBACK
      process.env.TWILIO_ACCOUNT_SID = 'ACpub'
      process.env.TWILIO_AUTH_TOKEN = 'token'
      process.env.TWILIO_SMS_FROM = '+15550007777'
      delete process.env.TWILIO_WHATSAPP_FROM
      process.env.MIRACHAT_PUBLIC_BASE_URL = 'https://voice.example.com/'
      expect(resolveTwilioVoiceConfigFromEnv()).toMatchObject({
        accountSid: 'ACpub',
        authToken: 'token',
        fromNumber: '+15550007777',
        statusCallbackUrl:
          'https://voice.example.com/mirachat/webhooks/twilio/voice-call-status',
      })
    } finally {
      for (const k of keys) {
        if (prev[k] === undefined) {
          delete process.env[k]
        } else {
          process.env[k] = prev[k]
        }
      }
    }
  })
})
