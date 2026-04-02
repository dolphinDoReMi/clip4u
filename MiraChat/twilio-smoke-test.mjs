import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { resolve } from 'node:path'
import { config as loadEnv } from 'dotenv'

const rootEnv = resolve(process.cwd(), '.env')
if (existsSync(rootEnv)) {
  loadEnv({ path: rootEnv, override: true })
}

const apiBase = (process.env.MIRACHAT_API_URL ?? 'http://127.0.0.1:4000').replace(/\/$/, '')
const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim() ?? ''
const authToken = process.env.TWILIO_AUTH_TOKEN?.trim() ?? ''
const smsFrom = process.env.TWILIO_SMS_FROM?.trim() ?? ''
const whatsappFrom = process.env.TWILIO_WHATSAPP_FROM?.trim() ?? ''
const explicitTestTo = process.env.TWILIO_TEST_TO?.trim() ?? ''
const ownerPhone = process.env.MIRACHAT_OWNER_PHONE_E164?.trim() ?? ''
const gatewayPort = Number(process.env.TWILIO_SMOKE_GATEWAY_PORT ?? 4026)

const normalizeAddress = value => value.trim().toLowerCase()

const fail = message => {
  console.error(message)
  process.exit(1)
}

if (!accountSid || !authToken) {
  fail('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are required')
}

const pickTestAddress = () => {
  if (explicitTestTo) {
    return explicitTestTo
  }
  if (ownerPhone && smsFrom) {
    return ownerPhone
  }
  if (ownerPhone && whatsappFrom) {
    return `whatsapp:${ownerPhone}`
  }
  return ''
}

const testTo = pickTestAddress()
if (!testTo) {
  fail('Set TWILIO_TEST_TO to a verified recipient address (for WhatsApp use whatsapp:+E164)')
}

const channel = testTo.startsWith('whatsapp:') ? 'twilio_whatsapp' : 'twilio_sms'
const sender = channel === 'twilio_whatsapp' ? whatsappFrom : smsFrom
if (!sender) {
  fail(
    channel === 'twilio_whatsapp'
      ? 'TWILIO_WHATSAPP_FROM is required for WhatsApp smoke tests'
      : 'TWILIO_SMS_FROM is required for SMS smoke tests',
  )
}
if (normalizeAddress(testTo) === normalizeAddress(sender)) {
  fail(`TWILIO_TEST_TO must be different from ${channel === 'twilio_whatsapp' ? 'TWILIO_WHATSAPP_FROM' : 'TWILIO_SMS_FROM'}`)
}

const fetchJson = async (url, init) => {
  const res = await fetch(url, init)
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  return { ok: res.ok, status: res.status, data, text }
}

const waitForGateway = async () => {
  for (let i = 0; i < 15; i += 1) {
    try {
      const res = await fetch(`${new URL(`http://127.0.0.1:${gatewayPort}`)}/health`)
      if (res.ok) {
        return
      }
    } catch {}
    await delay(1000)
  }
  fail(`Timed out waiting for gateway on port ${gatewayPort}`)
}

const run = async () => {
  const logs = []
  const child = spawn(
    process.execPath,
    ['apps/gateway-twilio/dist/index.js'],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        TWILIO_GATEWAY_PORT: String(gatewayPort),
        MIRACHAT_API_URL: apiBase,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )

  const capture = chunk => {
    const text = chunk.toString()
    logs.push(text)
    process.stdout.write(text)
  }
  child.stdout.on('data', capture)
  child.stderr.on('data', capture)

  try {
    await waitForGateway()

    const marker = `smoke-${Date.now()}`
    const inboundText = `Twilio smoke test ${marker}`
    const inbound = await fetch(`${apiBase}/mirachat/inbound`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        channel,
        accountId: accountSid,
        userId: process.env.MIRACHAT_USER_ID ?? 'demo-user',
        contactId: testTo,
        threadId: testTo,
        text: inboundText,
        senderId: testTo,
        messageId: `smoke-${Date.now()}`,
        roomId: null,
      }),
    })
    if (!inbound.ok) {
      fail(`Inbound enqueue failed: ${inbound.status} ${await inbound.text()}`)
    }

    let draft = null
    for (let i = 0; i < 20; i += 1) {
      const res = await fetchJson(`${apiBase}/mirachat/drafts`)
      if (!res.ok || !Array.isArray(res.data)) {
        await delay(1000)
        continue
      }
      draft = res.data.find(item => item.inboundText === inboundText && item.threadId === testTo) ?? null
      if (draft) {
        break
      }
      await delay(1000)
    }
    if (!draft) {
      fail('Timed out waiting for smoke-test draft creation')
    }

    const approve = await fetchJson(`${apiBase}/mirachat/drafts/${draft.id}/approve`, { method: 'POST' })
    if (!approve.ok) {
      fail(`Draft approval failed: ${approve.status} ${approve.text}`)
    }

    for (let i = 0; i < 10; i += 1) {
      const pending = await fetchJson(
        `${apiBase}/mirachat/pending-send?channel=${encodeURIComponent(channel)}&accountId=${encodeURIComponent(accountSid)}`,
      )
      const pendingItems = Array.isArray(pending.data) ? pending.data : []
      const stillPending = pendingItems.some(item => item.id === draft.id)
      const allLogs = logs.join('')
      if (allLogs.includes(`Twilio send failed draft=${draft.id}`)) {
        fail(`Twilio send failed for draft ${draft.id}`)
      }
      if (!stillPending) {
        console.log(
          JSON.stringify(
            {
              ok: true,
              draftId: draft.id,
              channel,
              to: testTo,
              from: sender,
            },
            null,
            2,
          ),
        )
        return
      }
      await delay(1500)
    }

    fail(`Draft ${draft.id} is still pending after waiting for Twilio send`)
  } finally {
    child.kill('SIGTERM')
    await delay(250)
  }
}

await run()
