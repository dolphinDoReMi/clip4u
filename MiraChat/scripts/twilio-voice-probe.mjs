#!/usr/bin/env node
/**
 * One-shot Twilio Voice diagnostics: account, US geo permissions, outbound test call + poll.
 * Loads MiraChat/.env from the repo root (run: node scripts/twilio-voice-probe.mjs from MiraChat/).
 */
import { config } from 'dotenv'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
config({ path: resolve(root, '.env') })

const sid = process.env.TWILIO_ACCOUNT_SID?.trim()
const token = process.env.TWILIO_AUTH_TOKEN?.trim()
const from = process.env.TWILIO_VOICE_FROM_NUMBER?.trim() || process.env.MIRACHAT_TWILIO_VOICE_FROM?.trim()
const to =
  process.env.MIRACHAT_VOICE_PROBE_TO?.trim() ||
  process.env.MIRACHAT_OWNER_PHONE_E164?.trim() ||
  ''

if (!sid || !token || !from) {
  console.error('Missing TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, or TWILIO_VOICE_FROM_NUMBER in .env')
  process.exit(1)
}
if (!to) {
  console.error('Set MIRACHAT_OWNER_PHONE_E164 or MIRACHAT_VOICE_PROBE_TO in .env for the callee.')
  process.exit(1)
}

const authHeader = 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64')
const jsonHeaders = { Authorization: authHeader }

async function getJson(url) {
  const res = await fetch(url, { headers: jsonHeaders })
  const text = await res.text()
  let data = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = { _raw: text.slice(0, 400) }
  }
  return { ok: res.ok, status: res.status, data }
}

console.log('=== Twilio voice probe ===\n')

const acc = await getJson(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}.json`)
if (acc.ok) {
  const a = acc.data
  console.log('Account:', a.friendly_name || sid)
  console.log('  status:', a.status)
  console.log('  type:', a.type || '(unknown)')
} else {
  console.log('Account fetch failed:', acc.status, acc.data)
}

const geo = await getJson('https://voice.twilio.com/v1/DialingPermissions/Countries/US')
if (geo.ok && geo.data) {
  const d = geo.data
  console.log('\nUS voice dialing permissions (low-risk / voice):')
  console.log(
    '  low_risk_numbers_enabled:',
    d.low_risk_numbers_enabled ?? d.low_risk_number_enabled ?? '(not in payload)',
  )
} else {
  console.log('\nUS dialing permissions: could not read (', geo.status, ') — check Console → Voice → geo permissions.')
}

const lookup = await getJson(
  `https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(to)}?Fields=line_type_intelligence`,
)
if (lookup.ok) {
  console.log('\nLookup (line type):', lookup.data.line_type_intelligence?.type || lookup.data)
} else if (lookup.status === 404 || lookup.status === 403) {
  console.log('\nLookup: not available for this account or number (HTTP', lookup.status, ')')
}

const say = `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice" language="en-US">MiraChat probe call. If you hear this, voice path is working.</Say></Response>`
const params = new URLSearchParams()
params.set('To', to)
params.set('From', from)
params.set('Twiml', say)
params.set('Timeout', '90')

const create = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Calls.json`, {
  method: 'POST',
  headers: {
    Authorization: authHeader,
    'Content-Type': 'application/x-www-form-urlencoded',
  },
  body: params.toString(),
})
const createText = await create.text()
let created = {}
try {
  created = createText ? JSON.parse(createText) : {}
} catch {
  created = { message: createText.slice(0, 300) }
}

if (!create.ok || !created.sid) {
  console.log('\nCreate call failed:', create.status, created.message || created)
  process.exit(1)
}

const callSid = created.sid
console.log('\nPlaced call', callSid, '→', to, '(ring timeout 90s, no status callback URL in this probe)')
console.log('Polling…\n')

const terminal = new Set(['completed', 'busy', 'failed', 'no-answer', 'canceled'])
let last = ''
for (let i = 0; i < 35; i++) {
  await new Promise((r) => setTimeout(r, 2000))
  const c = await getJson(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Calls/${encodeURIComponent(callSid)}.json`,
  )
  if (!c.ok) {
    console.log('  poll error', c.status)
    continue
  }
  const st = c.data.status
  const err = c.data.error_code ? ` error_code=${c.data.error_code} ${c.data.error_message || ''}` : ''
  if (st !== last) {
    console.log(`  ${i * 2}s  status=${st} duration=${c.data.duration ?? '0'}${err}`)
    last = st
  }
  if (terminal.has(st)) {
    console.log('\nFinal:', st, err.trim())
    break
  }
}

console.log(`
--- Only you can do on the phone (automations cannot) ---
• Turn off Silence Unknown Callers: Settings → Phone → Silence Unknown Callers.
• Turn off Focus / Do Not Disturb for testing.
• End any other call using this line (including other devices).
• Add your Twilio caller ID (${from}) as a contact so the handset is less likely to block it.
• If status stayed "busy" with duration 0: carrier often reports busy for filtered/blocked routes — try cellular only (disable Wi‑Fi calling briefly) or another handset.
`)
