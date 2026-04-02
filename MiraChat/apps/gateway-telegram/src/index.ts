import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'
import { createServer } from 'node:http'
import type { IncomingMessage } from 'node:http'
import { buildGatewayHealth } from '@delegate-ai/gateway-runtime'
import { Telegraf } from 'telegraf'
import {
  isTelegramWebhookAuthorized,
  normalizeTelegramUpdate,
  type TelegramUpdate,
} from './telegram.js'
import { createTelegramPluginRegistry } from './plugin-registry.js'

const mirachatRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const rootEnv = resolve(mirachatRoot, '.env')
if (existsSync(rootEnv)) {
  loadEnv({ path: rootEnv })
}

const botToken = process.env.TELEGRAM_BOT_TOKEN ?? ''
const apiBase = (process.env.MIRACHAT_API_URL ?? 'http://127.0.0.1:4000').replace(/\/$/, '')
const mirachatUserId = process.env.MIRACHAT_USER_ID ?? 'demo-user'
const accountId = process.env.TELEGRAM_ACCOUNT_ID ?? 'telegram-bot'
const port = Number(process.env.TELEGRAM_GATEWAY_PORT ?? 4020)
const pollMs = Number(process.env.TELEGRAM_POLL_MS ?? 5000)
const webhookPath = process.env.TELEGRAM_WEBHOOK_PATH ?? '/webhooks/telegram/message'
const webhookUrl = (process.env.TELEGRAM_WEBHOOK_URL ?? '').trim()
const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET ?? ''
const telegramApiRoot = (process.env.TELEGRAM_BOT_API_ROOT ?? 'https://api.telegram.org').replace(/\/$/, '')
const useWebhook = Boolean(webhookUrl)

let botProfile: { id: number; username?: string; first_name?: string } | null = null
let connectionStatus: 'ONLINE' | 'OFFLINE' | 'DEGRADED' | 'AUTH_REQUIRED' = botToken ? 'OFFLINE' : 'AUTH_REQUIRED'
const bot = new Telegraf(botToken, {
  telegram: {
    apiRoot: telegramApiRoot,
    webhookReply: false,
  },
})
const pluginRegistry = createTelegramPluginRegistry(bot, botToken)

const readBody = async (request: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}

const parseJson = <T>(raw: string): T | null => {
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

const patchConnectionAuth = async (status: 'ONLINE' | 'OFFLINE' | 'AUTH_REQUIRED'): Promise<void> => {
  connectionStatus = status
  await fetch(`${apiBase}/mirachat/connection/auth`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      channel: 'telegram',
      accountId,
      userId: mirachatUserId,
      status,
      qrPayload: null,
    }),
  }).catch(err => console.error('telegram auth patch failed', err))
}

const markSendFailed = async (id: string, error: unknown): Promise<void> => {
  const message = error instanceof Error ? error.message : String(error)
  const response = await fetch(`${apiBase}/mirachat/drafts/${id}/mark-send-failed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ error: message }),
  }).catch(fetchError => {
    console.error('telegram mark-send-failed request failed', id, fetchError)
    return null
  })
  if (response && !response.ok) {
    console.error('telegram mark-send-failed failed', id, await response.text())
  }
}

const ensureWebhook = async (): Promise<void> => {
  if (!useWebhook) {
    return
  }

  await bot.telegram.setWebhook(webhookUrl, {
    secret_token: webhookSecret || undefined,
    allowed_updates: ['message', 'edited_message'],
  })
}

const refreshBotProfile = async (options: { registerWebhook?: boolean } = {}): Promise<void> => {
  const { registerWebhook = true } = options
  if (!botToken) {
    botProfile = null
    await patchConnectionAuth('OFFLINE')
    return
  }

  try {
    botProfile = await bot.telegram.getMe()
    if (registerWebhook) {
      await ensureWebhook()
    }
    await patchConnectionAuth('ONLINE')
  } catch (error) {
    botProfile = null
    console.error('telegram getMe failed', error)
    await patchConnectionAuth('OFFLINE')
  }
}

const getWebhookInfo = async (): Promise<unknown> => bot.telegram.getWebhookInfo()

const postMirachatInbound = async (update: TelegramUpdate): Promise<boolean> => {
  const normalized = normalizeTelegramUpdate(update)
  if (!normalized) {
    return false
  }

  if (botProfile && normalized.senderId === String(botProfile.id)) {
    return false
  }

  const res = await fetch(`${apiBase}/mirachat/inbound`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      channel: normalized.channel,
      accountId,
      userId: mirachatUserId,
      contactId: normalized.contactId,
      roomId: normalized.roomId,
      threadId: normalized.threadId,
      text: normalized.text,
      senderId: normalized.senderId,
      messageId: normalized.messageId,
    }),
  })

  if (!res.ok) {
    throw new Error(`mirachat inbound ${res.status}: ${await res.text()}`)
  }

  return true
}

const sendTelegramOutbound = async (item: { threadId: string; text: string }): Promise<void> => {
  const plugin = pluginRegistry.resolve('telegram')
  await plugin.send({ threadId: item.threadId, text: item.text, channel: 'telegram' })
}

const pollPendingSends = async (): Promise<void> => {
  if (!botToken) {
    return
  }

  let res: Response
  try {
    res = await fetch(
      `${apiBase}/mirachat/pending-send?channel=${encodeURIComponent('telegram')}&accountId=${encodeURIComponent(accountId)}`,
    )
  } catch (error) {
    connectionStatus = 'DEGRADED'
    console.error('telegram pending-send fetch failed', error)
    return
  }

  if (!res.ok) {
    return
  }

  const items = (await res.json()) as Array<{ id: string; threadId: string; text: string }>
  for (const item of items) {
    try {
      await sendTelegramOutbound(item)
      connectionStatus = 'ONLINE'
      const mark = await fetch(`${apiBase}/mirachat/drafts/${item.id}/mark-sent`, { method: 'POST' })
      if (!mark.ok) {
        console.error('telegram mark-sent failed', item.id, await mark.text())
      }
    } catch (error) {
      console.error('telegram send failed', item.id, error)
      connectionStatus = 'DEGRADED'
      await markSendFailed(item.id, error)
    }
  }
}

bot.use(async (ctx, next) => {
  try {
    await postMirachatInbound(ctx.update as TelegramUpdate)
    await patchConnectionAuth('ONLINE')
  } catch (error) {
    console.error('telegram inbound middleware error', error)
    await patchConnectionAuth('OFFLINE')
    throw error
  }
  return next()
})

void refreshBotProfile()
if (botToken) {
  if (!useWebhook) {
    void bot.telegram.deleteWebhook({ drop_pending_updates: false }).catch(error => {
      console.error('telegram deleteWebhook failed', error)
    })
    void bot.launch({ dropPendingUpdates: false }).catch(error => {
      console.error('telegram polling launch failed', error)
      void patchConnectionAuth('OFFLINE')
    })
  }
  setInterval(() => {
    void pollPendingSends()
  }, pollMs)
}

createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)

  if (request.method === 'GET' && url.pathname === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(
      JSON.stringify(
        buildGatewayHealth({
        service: 'gateway-telegram',
          channel: 'telegram',
          configured: pluginRegistry.isConfigured(),
          connectionStatus,
          accountId,
          apiBase,
          mode: useWebhook ? 'webhook' : 'polling',
          webhookPath,
          plugins: pluginRegistry.health(),
          diagnostics: {
            botConfigured: Boolean(botToken),
            botUsername: botProfile?.username ?? null,
            telegramApiRoot,
            webhookUrl: useWebhook ? webhookUrl : null,
          },
        }),
      ),
    )
    return
  }

  if (request.method === 'GET' && url.pathname === webhookPath) {
    response.writeHead(200, { 'content-type': 'text/plain' })
    response.end('ok')
    return
  }

  if (request.method === 'GET' && url.pathname === '/telegram/webhook-info') {
    try {
      const info = botToken ? await getWebhookInfo() : { ok: false, description: 'TELEGRAM_BOT_TOKEN missing' }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(info))
    } catch (error) {
      response.writeHead(500, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
    }
    return
  }

  if (request.method === 'POST' && url.pathname === '/telegram/register-webhook') {
    if (!useWebhook) {
      response.writeHead(400, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'TELEGRAM_WEBHOOK_URL is required for webhook mode' }))
      return
    }
    try {
      await ensureWebhook()
      const info = botToken ? await getWebhookInfo() : { ok: false, description: 'TELEGRAM_BOT_TOKEN missing' }
      await refreshBotProfile({ registerWebhook: false })
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ ok: true, webhook: info }))
    } catch (error) {
      response.writeHead(500, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
    }
    return
  }

  if (request.method === 'POST' && url.pathname === webhookPath) {
    const header = request.headers['x-telegram-bot-api-secret-token']
    const secretHeader = Array.isArray(header) ? header[0] : header
    if (!isTelegramWebhookAuthorized(secretHeader, webhookSecret)) {
      response.writeHead(403, { 'content-type': 'text/plain' })
      response.end('invalid secret')
      return
    }

    const raw = await readBody(request)
    const update = parseJson<TelegramUpdate>(raw)
    if (!update) {
      response.writeHead(400, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: 'invalid json' }))
      return
    }

    try {
      await bot.handleUpdate(update as Parameters<typeof bot.handleUpdate>[0])
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ ok: true, forwarded: Boolean(normalizeTelegramUpdate(update)) }))
    } catch (error) {
      console.error('telegram inbound error', error)
      await patchConnectionAuth('OFFLINE')
      response.writeHead(500, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
    }
    return
  }

  response.writeHead(404, { 'content-type': 'text/plain' })
  response.end('not found')
}).listen(port, () => {
  console.log(`gateway-telegram listening on http://localhost:${port}`)
  if (useWebhook) {
    console.log(`Webhook (POST): http://localhost:${port}${webhookPath}`)
    console.log(`Auto-register webhook target: ${webhookUrl}`)
  } else {
    console.log('Telegram polling mode enabled (no TELEGRAM_WEBHOOK_URL set)')
  }
})
