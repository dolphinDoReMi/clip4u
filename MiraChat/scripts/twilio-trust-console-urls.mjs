#!/usr/bin/env node
/**
 * Print Twilio Console deep links for Trust Hub + the active Voice From number.
 * Run from MiraChat/: npm run twilio:trust-urls
 */
import { config } from 'dotenv'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
config({ path: resolve(root, '.env') })

const sid = process.env.TWILIO_ACCOUNT_SID?.trim()
const token = process.env.TWILIO_AUTH_TOKEN?.trim()
const from = process.env.TWILIO_VOICE_FROM_NUMBER?.trim() || process.env.MIRACHAT_TWILIO_VOICE_FROM?.trim()

if (!sid || !token) {
  console.error('Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in MiraChat/.env')
  process.exit(1)
}

console.log('Account SID:', sid)
if (from) {
  console.log('Voice From:', from)
} else {
  console.log('Voice From: (set TWILIO_VOICE_FROM_NUMBER in .env)')
}

console.log('\n--- Trust Hub (browser) ---')
console.log('Overview:  https://console.twilio.com/us1/account/trust-hub/overview')
console.log('Profiles:  https://console.twilio.com/us1/account/trust-hub/customer-profiles')
console.log('\nDocs:')
console.log('  Trust Hub:     https://www.twilio.com/docs/trust-hub')
console.log('  SHAKEN/STIR:   https://www.twilio.com/docs/voice/trusted-calling-with-shakenstir')
console.log('  CNAM:          https://www.twilio.com/docs/voice/brand-your-calls-using-cnam')
console.log('  Voice Integrity: https://www.twilio.com/docs/voice/spam-monitoring-with-voiceintegrity')

if (!from) {
  process.exit(0)
}

const auth = 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64')
const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(from)}`
const res = await fetch(url, { headers: { Authorization: auth } })
const data = await res.json().catch(() => ({}))
const row = data.incoming_phone_numbers?.[0]

if (!row?.sid) {
  console.log('\n--- Phone number ---')
  console.log('Could not resolve IncomingPhoneNumber SID for', from, res.ok ? '' : `HTTP ${res.status}`)
  console.log('Open: https://console.twilio.com/us1/develop/phone-numbers/manage/incoming')
  process.exit(0)
}

const pn = row.sid
console.log('\n--- Your Voice number ---')
console.log('IncomingPhoneNumber SID:', pn)
console.log('Configure: https://console.twilio.com/us1/develop/phone-numbers/manage/incoming/' + pn + '/configure')
