#!/usr/bin/env node
/**
 * Deep debug for outbound Voice to a single mobile: number caps, Lookup, last calls,
 * optional Twilio-hosted demo TwiML call (isolates MiraChat/TwiML).
 *
 * Usage (from MiraChat/): node scripts/twilio-voice-deep-debug.mjs
 *   TWILIO_VOICE_FROM_NUMBER, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, MIRACHAT_OWNER_PHONE_E164 in .env
 *
 * Flags:
 *   --place-demo   Place one call using http://demo.twilio.com/docs/voice.xml (not MiraChat)
 */
import { config } from 'dotenv'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
config({ path: resolve(root, '.env') })

const placeDemo = process.argv.includes('--place-demo')
const sid = process.env.TWILIO_ACCOUNT_SID?.trim()
const token = process.env.TWILIO_AUTH_TOKEN?.trim()
const from = process.env.TWILIO_VOICE_FROM_NUMBER?.trim()
const to = process.env.MIRACHAT_OWNER_PHONE_E164?.trim() || process.env.MIRACHAT_VOICE_PROBE_TO?.trim()

if (!sid || !token || !from || !to) {
  console.error('Need TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VOICE_FROM_NUMBER, MIRACHAT_OWNER_PHONE_E164 (or MIRACHAT_VOICE_PROBE_TO)')
  process.exit(1)
}

const auth = 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64')
const h = { Authorization: auth }

async function j(url, opt = {}) {
  const res = await fetch(url, { ...opt, headers: { ...h, ...opt.headers } })
  const text = await res.text()
  let data = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = { _raw: text.slice(0, 400) }
  }
  return { ok: res.ok, status: res.status, data }
}

console.log('=== Twilio voice deep debug ===\n')

const list = await j(
  `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(from)}`,
)
const nums = list.data.incoming_phone_numbers || []
if (!nums.length) {
  console.log('IncomingPhoneNumbers filter: no row for From (check number is on this Account SID).')
  console.log('Raw:', JSON.stringify(list.data).slice(0, 500))
} else {
  const n = nums[0]
  console.log('From number on account:', n.phone_number, n.sid)
  console.log('  capabilities:', n.capabilities)
  console.log('  voice_url:', n.voice_url || '(none)')
  console.log('  voice_receive_mode:', n.voice_receive_mode)
}

const lu = await j(
  `https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(to)}?Fields=line_type_intelligence`,
)
if (lu.ok && lu.data) {
  const lt = lu.data.line_type_intelligence
  console.log('\nLookup (To): valid=', lu.data.valid, 'country=', lu.data.country_code)
  if (lt) console.log('  line type:', lt.type, 'carrier:', lt.carrier_name)
} else {
  console.log('\nLookup failed:', lu.status, lu.data)
}

const calls = await j(
  `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Calls.json?PageSize=5`,
)
console.log('\nLast 5 calls (To/From/status/duration):')
for (const c of calls.data.calls || []) {
  console.log(`  ${c.sid} ${c.status} dur=${c.duration} ${c.from} -> ${c.to}`)
}

console.log(`
--- Interpretation ---
• If status is "busy" with duration 0 for BOTH app calls and demo TwiML, Twilio reached the
  callee carrier which returned BUSY before ring. That is not fixable in MiraChat code.
• AT&T Wireless: check AT&T ActiveArmor / Call Protect / blocked list; try disabling spam filtering
  for a test; add ${from} as a contact.
• Prove isolation: set MIRACHAT_VOICE_PROBE_TO to a different phone (friend/landline). If that
  rings, the issue is specific to the original mobile line.
`)

if (placeDemo) {
  const body = new URLSearchParams()
  body.set('To', to)
  body.set('From', from)
  body.set('Url', 'http://demo.twilio.com/docs/voice.xml')
  body.set('Timeout', '60')
  const cr = await j(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Calls.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  const id = cr.data.sid
  console.log('\nDemo URL call created:', id, cr.ok ? '' : cr.data)
  if (id) {
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 2000))
      const g = await j(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Calls/${encodeURIComponent(id)}.json`,
      )
      const st = g.data.status
      console.log(`  poll ${i * 2}s: ${st} duration=${g.data.duration}`)
      if (['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(st)) break
    }
  }
}
