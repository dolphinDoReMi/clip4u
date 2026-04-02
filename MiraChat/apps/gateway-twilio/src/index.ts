import { createServer } from 'node:http'
import { parse as parseFormBody } from 'node:querystring'
import type { Channel } from '@delegate-ai/adapter-types'
import { buildGatewayHealth } from '@delegate-ai/gateway-runtime'
import twilio from 'twilio'
import { gatewayConfig } from './config.js'
import { createTwilioPluginRegistry } from './plugin-registry.js'
import { isTwilioChannel, twilioChannels, type PendingSendItem } from './plugin-types.js'
import { isTwilioRestLike } from './twilio-errors.js'

/** Twilio SDK TwiML builder (Programmable Messaging). */
const MessagingResponse = twilio.twiml.MessagingResponse
const pluginRegistry = createTwilioPluginRegistry(gatewayConfig)
let connectionStatus: 'ONLINE' | 'OFFLINE' | 'DEGRADED' = pluginRegistry.isConfigured() ? 'ONLINE' : 'OFFLINE'

/** First value for Twilio form fields (handles rare duplicate keys). */
const formField = (params: Record<string, string | string[] | undefined>, key: string): string => {
  const v = params[key]
  if (v === undefined) {
    return ''
  }
  return Array.isArray(v) ? (v[0] ?? '') : v
}

/**
 * Parse application/x-www-form-urlencoded body the same way Twilio signs it.
 * @see https://www.twilio.com/docs/usage/security#validating-requests
 */
const parseTwilioWebhookParams = (body: string): Record<string, string | string[]> =>
  parseFormBody(body) as Record<string, string | string[]>

/**
 * Validates X-Twilio-Signature using the official SDK (standard webhooks with POST body params).
 * Note: use {@link twilio.validateRequestWithBody} only when the webhook URL includes `bodySHA256` (signed payload flow).
 */
const validateTwilioSignature = (
  pathname: string,
  signature: string | undefined,
  params: Record<string, string | string[]>,
): boolean => {
  if (gatewayConfig.skipSig) {
    return true
  }
  if (!gatewayConfig.authToken || !signature) {
    return false
  }
  if (!gatewayConfig.webhookBase) {
    console.warn('TWILIO_WEBHOOK_BASE unset; refusing webhook (set TWILIO_SKIP_SIGNATURE=1 for local dev)')
    return false
  }
  const url = `${gatewayConfig.webhookBase}${pathname}`
  return twilio.validateRequest(gatewayConfig.authToken, signature, url, params)
}

const emptyMessagingTwiml = (): string => new MessagingResponse().toString()

const readBody = async (request: import('node:http').IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}

const postMirachatInbound = async (input: {
  channel: Channel
  accountId: string
  userId: string
  contactId: string
  threadId: string
  text: string
  senderId: string
  messageId: string
}): Promise<void> => {
  const res = await fetch(`${gatewayConfig.apiBase}/mirachat/inbound`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      channel: input.channel,
      accountId: input.accountId,
      userId: input.userId,
      contactId: input.contactId,
      threadId: input.threadId,
      text: input.text,
      senderId: input.senderId,
      messageId: input.messageId,
      roomId: null,
    }),
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`mirachat inbound ${res.status}: ${t}`)
  }
}

const channelForAddress = (from: string): Channel =>
  from.toLowerCase().startsWith('whatsapp:') ? 'twilio_whatsapp' : 'twilio_sms'

const logTwilioError = (context: string, err: unknown): void => {
  connectionStatus = 'DEGRADED'
  if (isTwilioRestLike(err)) {
    console.error(context, err.message, { code: err.code, status: err.status, moreInfo: err.moreInfo })
    return
  }
  console.error(context, err)
}

const markSendFailed = async (id: string, err: unknown): Promise<void> => {
  const error = err instanceof Error ? err.message : String(err)
  const response = await fetch(`${gatewayConfig.apiBase}/mirachat/drafts/${id}/mark-send-failed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ error }),
  }).catch(fetchError => {
    console.error('mark-send-failed request failed', id, fetchError)
    return null
  })
  if (response && !response.ok) {
    console.error('mark-send-failed failed', id, await response.text())
  }
}

const pollPendingSends = async (): Promise<void> => {
  if (!pluginRegistry.isConfigured() || !gatewayConfig.accountSid) {
    return
  }
  for (const channel of twilioChannels) {
    let res: Response
    try {
      res = await fetch(
        `${gatewayConfig.apiBase}/mirachat/pending-send?channel=${encodeURIComponent(channel)}&accountId=${encodeURIComponent(gatewayConfig.accountSid)}`,
      )
    } catch (e) {
      connectionStatus = 'DEGRADED'
      console.error('pending-send fetch failed', channel, e)
      continue
    }
    if (!res.ok) {
      continue
    }
    const items = (await res.json()) as PendingSendItem[]
    for (const item of items) {
      if (!isTwilioChannel(item.channel)) {
        console.warn('Skipping unsupported Twilio pending-send channel', item.channel, item.id)
        continue
      }
      const channel = item.channel
      try {
        const plugin = pluginRegistry.resolve(channel)
        await plugin.send({ threadId: item.threadId, text: item.text, channel })
        connectionStatus = 'ONLINE'
        const mark = await fetch(`${gatewayConfig.apiBase}/mirachat/drafts/${item.id}/mark-sent`, {
          method: 'POST',
        })
        if (!mark.ok) {
          console.error('mark-sent failed', item.id, await mark.text())
        }
      } catch (e) {
        logTwilioError(`Twilio send failed draft=${item.id}`, e)
        await markSendFailed(item.id, e)
      }
    }
  }
}

if (pluginRegistry.isConfigured() && gatewayConfig.accountSid) {
  setInterval(() => {
    void pollPendingSends()
  }, gatewayConfig.pollMs)
}

const webhookPath = '/webhooks/twilio/message'
const statusWebhookPath = '/webhooks/twilio/status'

const forwardStatusToApi = async (params: Record<string, string | string[]>): Promise<void> => {
  const flat: Record<string, string> = {}
  for (const [k, v] of Object.entries(params)) {
    flat[k] = Array.isArray(v) ? (v[0] ?? '') : v
  }
  await fetch(`${gatewayConfig.apiBase}/mirachat/instrumentation/twilio-status`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(flat),
  }).catch(err => console.error('twilio status forward failed', err))
}

createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)

  if (request.method === 'GET' && url.pathname === webhookPath) {
    response.writeHead(200, { 'content-type': 'text/plain' })
    response.end('ok')
    return
  }

  if (request.method === 'POST' && url.pathname === statusWebhookPath) {
    const body = await readBody(request)
    const params = parseTwilioWebhookParams(body)
    const sigRaw = request.headers['x-twilio-signature']
    const signature = Array.isArray(sigRaw) ? sigRaw[0] : sigRaw
    if (!validateTwilioSignature(statusWebhookPath, signature, params)) {
      response.writeHead(403, { 'content-type': 'text/plain' })
      response.end('invalid signature')
      return
    }
    await forwardStatusToApi(params)
    response.writeHead(204)
    response.end()
    return
  }

  if (request.method === 'GET' && url.pathname === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(
      JSON.stringify(
        buildGatewayHealth({
        service: 'gateway-twilio',
          channel: 'twilio',
          configured: pluginRegistry.isConfigured(),
          connectionStatus,
          accountId: gatewayConfig.accountSid || null,
          apiBase: gatewayConfig.apiBase,
          mode: 'webhook+polling',
          webhookPath,
          plugins: pluginRegistry.health(),
          diagnostics: {
            statusWebhookPath,
          },
        }),
      ),
    )
    return
  }

  if (request.method === 'POST' && url.pathname === webhookPath) {
    const body = await readBody(request)
    const params = parseTwilioWebhookParams(body)
    const sigRaw = request.headers['x-twilio-signature']
    const signature = Array.isArray(sigRaw) ? sigRaw[0] : sigRaw

    if (!validateTwilioSignature(webhookPath, signature, params)) {
      response.writeHead(403, { 'content-type': 'text/plain' })
      response.end('invalid signature')
      return
    }

    const from = formField(params, 'From')
    const text = formField(params, 'Body')
    const messageSid = formField(params, 'MessageSid') || formField(params, 'SmsSid') || `tw-${Date.now()}`
    if (!from) {
      response.writeHead(400, { 'content-type': 'text/plain' })
      response.end('missing From')
      return
    }

    const channel = channelForAddress(from)
    const accountId = gatewayConfig.accountSid || 'twilio-dev'

    try {
      await postMirachatInbound({
        channel,
        accountId,
        userId: gatewayConfig.mirachatUserId,
        contactId: from,
        threadId: from,
        text,
        senderId: from,
        messageId: messageSid,
      })
      connectionStatus = 'ONLINE'
    } catch (e) {
      connectionStatus = 'DEGRADED'
      console.error('mirachat inbound error', e)
      response.writeHead(500, { 'content-type': 'text/xml; charset=utf-8' })
      response.end(emptyMessagingTwiml())
      return
    }

    response.writeHead(200, { 'content-type': 'text/xml; charset=utf-8' })
    response.end(emptyMessagingTwiml())
    return
  }

  response.writeHead(404, { 'content-type': 'text/plain' })
  response.end('not found')
}).listen(gatewayConfig.port, () => {
  console.log(`gateway-twilio listening on http://localhost:${gatewayConfig.port}`)
  console.log(`Webhook (POST): http://localhost:${gatewayConfig.port}${webhookPath}`)
  console.log(
    `Status callback (POST): http://localhost:${gatewayConfig.port}${statusWebhookPath} → API /mirachat/instrumentation/twilio-status`,
  )
  console.log(`Twilio transport routing: ${JSON.stringify(gatewayConfig.pluginByChannel)}`)
  if (gatewayConfig.skipSig) {
    console.warn('TWILIO_SKIP_SIGNATURE enabled — do not use in production')
  }
})
