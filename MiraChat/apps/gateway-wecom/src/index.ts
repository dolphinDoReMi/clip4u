import { existsSync } from 'node:fs'
import { createServer, type IncomingMessage } from 'node:http'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'
import { buildGatewayHealth } from '@delegate-ai/gateway-runtime'
import {
  fetchWeComAccessToken,
  normalizeWeComInbound,
  parseWeComEncryptedMessage,
  parseWeComVerificationEcho,
  sendWeComExternalContactText,
  WeComAccessTokenCache,
  type WeComCallbackQuery,
} from './wecom.js'

const mirachatRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const rootEnv = resolve(mirachatRoot, '.env')
if (existsSync(rootEnv)) {
  loadEnv({ path: rootEnv })
}

const apiBase = (process.env.MIRACHAT_API_URL ?? 'http://127.0.0.1:4000').replace(/\/$/, '')
const userId = process.env.MIRACHAT_USER_ID ?? process.env.USER_ID ?? 'demo-user'
const accountId = process.env.WECOM_ACCOUNT_ID ?? 'wecom-app'
const port = Number(process.env.WECOM_GATEWAY_PORT ?? 4030)
const webhookPath = process.env.WECOM_WEBHOOK_PATH ?? '/webhooks/wecom/message'
const pollMs = Number(process.env.WECOM_POLL_MS ?? 5000)
const corpSecret = process.env.WECOM_CORP_SECRET ?? ''
const agentId = process.env.WECOM_AGENT_ID ?? ''
const outboundEndpoint = (process.env.WECOM_OUTBOUND_ENDPOINT ?? '').trim()
const cryptoConfig = {
  token: process.env.WECOM_TOKEN ?? '',
  encodingAesKey: process.env.WECOM_ENCODING_AES_KEY ?? '',
  corpId: process.env.WECOM_CORP_ID ?? '',
}
const accessTokenCache = new WeComAccessTokenCache(() =>
  fetchWeComAccessToken({
    corpId: cryptoConfig.corpId,
    corpSecret,
  }),
)
let connectionStatus: 'ONLINE' | 'OFFLINE' | 'DEGRADED' | 'AUTH_REQUIRED' = 'OFFLINE'

const readBody = async (request: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}

const patchConnectionAuth = async (status: 'ONLINE' | 'OFFLINE' | 'AUTH_REQUIRED'): Promise<void> => {
  connectionStatus = status
  await fetch(`${apiBase}/mirachat/connection/auth`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      channel: 'wecom',
      accountId,
      userId,
      status,
      qrPayload: null,
    }),
  }).catch(error => console.error('wecom auth patch failed', error))
}

const markSendFailed = async (id: string, error: unknown): Promise<void> => {
  const message = error instanceof Error ? error.message : String(error)
  const response = await fetch(`${apiBase}/mirachat/drafts/${id}/mark-send-failed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ error: message }),
  }).catch(fetchError => {
    console.error('wecom mark-send-failed request failed', id, fetchError)
    return null
  })
  if (response && !response.ok) {
    console.error('wecom mark-send-failed failed', id, await response.text())
  }
}

const postMirachatInbound = async (payload: ReturnType<typeof normalizeWeComInbound>): Promise<void> => {
  if (!payload) {
    return
  }

  const response = await fetch(`${apiBase}/mirachat/inbound`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      channel: 'wecom',
      accountId,
      userId,
      contactId: payload.contactId,
      roomId: payload.roomId,
      threadId: payload.threadId,
      text: payload.text,
      senderId: payload.senderId,
      messageId: payload.messageId,
    }),
  })

  if (!response.ok) {
    throw new Error(`mirachat inbound ${response.status}: ${await response.text()}`)
  }
}

const pollPendingSends = async (): Promise<void> => {
  if (!agentId || (!corpSecret && !outboundEndpoint)) {
    return
  }

  let response: Response
  try {
    response = await fetch(
      `${apiBase}/mirachat/pending-send?channel=${encodeURIComponent('wecom')}&accountId=${encodeURIComponent(accountId)}`,
    )
  } catch (error) {
    connectionStatus = 'DEGRADED'
    console.error('wecom pending-send fetch failed', error)
    return
  }

  if (!response.ok) {
    return
  }

  const items = (await response.json()) as Array<{
    id: string
    threadId: string
    contactId?: string | null
    roomId?: string | null
    text: string
  }>
  for (const item of items) {
    try {
      const externalUserId = (item.contactId ?? item.threadId ?? '').trim()
      if (!externalUserId) {
        throw new Error('wecom outbound target missing contact/thread id')
      }
      if (outboundEndpoint) {
        const send = await fetch(outboundEndpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            draftId: item.id,
            threadId: item.threadId,
            contactId: item.contactId ?? null,
            roomId: item.roomId ?? null,
            text: item.text,
            channel: 'wecom',
            accountId,
          }),
        })
        if (!send.ok) {
          throw new Error(`wecom outbound endpoint ${send.status}: ${await send.text()}`)
        }
      } else {
        const accessToken = await accessTokenCache.get()
        await sendWeComExternalContactText({
          accessToken,
          agentId,
          externalUserId,
          text: item.text,
        })
      }
      const mark = await fetch(`${apiBase}/mirachat/drafts/${item.id}/mark-sent`, { method: 'POST' })
      connectionStatus = 'ONLINE'
      if (!mark.ok) {
        console.error('wecom mark-sent failed', item.id, await mark.text())
      }
    } catch (error) {
      console.error('wecom outbound send failed', item.id, error)
      connectionStatus = 'DEGRADED'
      await markSendFailed(item.id, error)
    }
  }
}

const ensureCryptoConfig = (): boolean =>
  Boolean(cryptoConfig.token && cryptoConfig.encodingAesKey && cryptoConfig.corpId)

if (agentId && (corpSecret || outboundEndpoint)) {
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
        service: 'gateway-wecom',
          channel: 'wecom',
          configured: Boolean(agentId && (corpSecret || outboundEndpoint)),
          connectionStatus,
          accountId,
          apiBase,
          mode: 'webhook+polling',
          webhookPath,
          diagnostics: {
            cryptoConfigured: ensureCryptoConfig(),
            outboundConfigured: Boolean(agentId && (corpSecret || outboundEndpoint)),
            agentId: agentId || null,
            outboundEndpoint: outboundEndpoint || null,
          },
        }),
      ),
    )
    return
  }

  if (!ensureCryptoConfig()) {
    response.writeHead(500, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: 'WECOM_TOKEN, WECOM_ENCODING_AES_KEY, and WECOM_CORP_ID are required' }))
    return
  }

  if (request.method === 'GET' && url.pathname === webhookPath) {
    try {
      const echo = parseWeComVerificationEcho(
        Object.fromEntries(url.searchParams.entries()) as WeComCallbackQuery,
        cryptoConfig,
      )
      await patchConnectionAuth('ONLINE')
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
      response.end(echo)
    } catch (error) {
      await patchConnectionAuth('AUTH_REQUIRED')
      response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
      response.end(`invalid wecom verification: ${error instanceof Error ? error.message : String(error)}`)
    }
    return
  }

  if (request.method === 'POST' && url.pathname === webhookPath) {
    try {
      const body = await readBody(request)
      const decryptedXml = parseWeComEncryptedMessage(
        body,
        Object.fromEntries(url.searchParams.entries()) as WeComCallbackQuery,
        cryptoConfig,
      )
      const normalized = normalizeWeComInbound(decryptedXml)
      if (normalized) {
        await postMirachatInbound(normalized)
      }
      await patchConnectionAuth('ONLINE')
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('success')
    } catch (error) {
      console.error('wecom callback failed', error)
      await patchConnectionAuth('OFFLINE')
      response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('failed')
    }
    return
  }

  response.writeHead(404, { 'content-type': 'application/json' })
  response.end(JSON.stringify({ error: 'Not found' }))
}).listen(port, () => {
  console.log(`gateway-wecom listening on http://localhost:${port}`)
  console.log(`Webhook: ${webhookPath}`)
})
