/**
 * Outbound “notify” voice calls via Twilio REST (Programmable Voice).
 * Uses inline TwiML — no webhook URL required for simple TTS playback.
 */

export type DisclosureMode = 'on_behalf' | 'neutral'

export interface TwilioVoiceNotifyConfig {
  accountSid: string
  authToken: string
  fromNumber: string
  /** Public HTTPS URL for Twilio call lifecycle webhooks (optional). */
  statusCallbackUrl?: string
  /** Ring timeout in seconds (Twilio allows 1–600; default 60 if unset). */
  timeoutSeconds?: number
}

export interface PlaceOutboundNotifyInput {
  to: string
  message: string
  disclosureMode?: DisclosureMode
  /** Shown when disclosureMode is on_behalf */
  callerName?: string
  maxMessageChars?: number
}

export interface PlaceOutboundNotifyResult {
  callSid: string
  status: string
}

const escapeXml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const trim = (value: string | undefined): string => (value ?? '').trim()

/**
 * TwiML for a single Say — delegation-first copy when mode is on_behalf.
 */
export const buildNotifyTwiml = (input: PlaceOutboundNotifyInput): string => {
  const mode = input.disclosureMode ?? 'on_behalf'
  const name = trim(input.callerName) || 'the person who requested this call'
  const prefix = mode === 'on_behalf' ? `This is an automated call on behalf of ${name}. ` : ''
  let body = prefix + trim(input.message)
  const max = input.maxMessageChars ?? 1200
  if (body.length > max) {
    body = body.slice(0, max)
  }
  const safe = escapeXml(body)
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice" language="en-US">${safe}</Say></Response>`
}

export const placeOutboundNotifyCall = async (
  config: TwilioVoiceNotifyConfig,
  input: PlaceOutboundNotifyInput,
  fetchImpl: typeof fetch = fetch,
): Promise<PlaceOutboundNotifyResult> => {
  const twiml = buildNotifyTwiml(input)
  const accountSid = trim(config.accountSid)
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Calls.json`
  const body = new URLSearchParams()
  body.set('To', trim(input.to))
  body.set('From', trim(config.fromNumber))
  body.set('Twiml', twiml)

  const cb = trim(config.statusCallbackUrl)
  if (cb) {
    body.set('StatusCallback', cb)
    for (const ev of ['initiated', 'ringing', 'answered', 'completed']) {
      body.append('StatusCallbackEvent', ev)
    }
    body.set('StatusCallbackMethod', 'POST')
  }
  const timeout =
    config.timeoutSeconds != null && Number.isFinite(config.timeoutSeconds)
      ? Math.min(600, Math.max(1, Math.floor(config.timeoutSeconds)))
      : null
  if (timeout != null) {
    body.set('Timeout', String(timeout))
  }

  const auth = Buffer.from(`${accountSid}:${trim(config.authToken)}`).toString('base64')
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  })
  const text = await res.text()
  let json: { sid?: string; status?: string; message?: string } = {}
  try {
    json = text ? (JSON.parse(text) as typeof json) : {}
  } catch {
    throw new Error(`Twilio voice: invalid JSON response (HTTP ${res.status})`)
  }
  if (!res.ok) {
    throw new Error(`Twilio voice: ${json.message ?? text.slice(0, 240)}`)
  }
  if (!json.sid) {
    throw new Error('Twilio voice: missing Call SID in response')
  }
  return { callSid: json.sid, status: json.status ?? 'unknown' }
}

/**
 * Env resolution: MiraChat-prefixed vars first, then common Twilio names.
 */
export const resolveTwilioVoiceConfigFromEnv = (): TwilioVoiceNotifyConfig | null => {
  const accountSid = trim(process.env.MIRACHAT_TWILIO_ACCOUNT_SID ?? process.env.TWILIO_ACCOUNT_SID)
  const authToken = trim(process.env.MIRACHAT_TWILIO_AUTH_TOKEN ?? process.env.TWILIO_AUTH_TOKEN)
  let fromNumber = trim(process.env.MIRACHAT_TWILIO_VOICE_FROM ?? process.env.TWILIO_VOICE_FROM_NUMBER)
  if (!fromNumber) {
    const sms = trim(process.env.TWILIO_SMS_FROM)
    if (sms && !/^whatsapp:/i.test(sms)) {
      fromNumber = sms
    }
  }
  if (!fromNumber) {
    const wa = trim(process.env.TWILIO_WHATSAPP_FROM)
    const m = wa.match(/^whatsapp:(\+\d{6,15})$/i)
    if (m) {
      fromNumber = m[1]
    }
  }
  if (!accountSid || !authToken || !fromNumber) {
    return null
  }
  const explicitCallback = trim(
    process.env.MIRACHAT_TWILIO_VOICE_STATUS_CALLBACK ?? process.env.TWILIO_VOICE_STATUS_CALLBACK,
  )
  const publicBase = trim(process.env.MIRACHAT_PUBLIC_BASE_URL ?? process.env.MIRACHAT_API_PUBLIC_URL ?? '')
  const derivedCallback = publicBase
    ? `${publicBase.replace(/\/$/, '')}/mirachat/webhooks/twilio/voice-call-status`
    : ''
  const statusCallbackUrl = explicitCallback || derivedCallback
  const timeoutRaw = trim(
    process.env.MIRACHAT_TWILIO_VOICE_RING_TIMEOUT ?? process.env.TWILIO_VOICE_RING_TIMEOUT,
  )
  const timeoutParsed = timeoutRaw ? Number(timeoutRaw) : NaN
  const timeoutSeconds = Number.isFinite(timeoutParsed) ? timeoutParsed : undefined

  const cfg: TwilioVoiceNotifyConfig = { accountSid, authToken, fromNumber }
  if (statusCallbackUrl) {
    cfg.statusCallbackUrl = statusCallbackUrl
  }
  if (timeoutSeconds != null) {
    cfg.timeoutSeconds = timeoutSeconds
  }
  return cfg
}
