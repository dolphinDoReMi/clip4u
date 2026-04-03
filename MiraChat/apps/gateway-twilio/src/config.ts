import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'
import type { TwilioChannel } from './plugin-types.js'

const mirachatRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const rootEnv = resolve(mirachatRoot, '.env')
if (existsSync(rootEnv)) {
  loadEnv({ path: rootEnv, override: true })
}

export type TwilioGatewayConfig = {
  accountSid: string
  authToken: string
  apiKeySid: string
  apiKeySecret: string
  apiBase: string
  mirachatUserId: string
  smsFrom: string
  whatsappFrom: string
  webhookBase: string
  skipSig: boolean
  port: number
  pollMs: number
  pluginByChannel: Record<TwilioChannel, string>
}

export const gatewayConfig: TwilioGatewayConfig = {
  accountSid: process.env.TWILIO_ACCOUNT_SID ?? '',
  authToken: process.env.TWILIO_AUTH_TOKEN ?? '',
  apiKeySid: process.env.TWILIO_API_KEY_SID ?? '',
  apiKeySecret: process.env.TWILIO_API_KEY_SECRET ?? '',
  apiBase: (process.env.MIRACHAT_API_URL ?? 'http://127.0.0.1:4000').replace(/\/$/, ''),
  mirachatUserId: process.env.MIRACHAT_USER_ID ?? 'demo-user',
  smsFrom: process.env.TWILIO_SMS_FROM ?? '',
  whatsappFrom: process.env.TWILIO_WHATSAPP_FROM ?? '',
  webhookBase: (process.env.TWILIO_WEBHOOK_BASE ?? '').replace(/\/$/, ''),
  skipSig: process.env.TWILIO_SKIP_SIGNATURE === '1' || process.env.TWILIO_SKIP_SIGNATURE === 'true',
  port: Number(process.env.TWILIO_GATEWAY_PORT ?? 4010),
  pollMs: Number(process.env.TWILIO_POLL_MS ?? 5000),
  pluginByChannel: {
    twilio_sms: process.env.TWILIO_SMS_PLUGIN ?? 'programmable-messaging',
    twilio_whatsapp: process.env.TWILIO_WHATSAPP_PLUGIN ?? 'programmable-messaging',
  },
}
