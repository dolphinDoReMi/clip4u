import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'
import { Client, LocalAuth } from 'whatsapp-web.js'
import {
  buildGatewayHealth,
  createMirachatApiClient,
  type ConnectionStatus,
} from '@delegate-ai/gateway-runtime'

const mirachatRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const rootEnv = resolve(mirachatRoot, '.env')
if (existsSync(rootEnv)) {
  loadEnv({ path: rootEnv })
}

function resolveChromiumPath(): string | undefined {
  const candidates = [
    process.env.CHROME_BIN,
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/usr/bin/chromium',
  ].filter(Boolean) as string[]

  return candidates.find(candidate => existsSync(candidate))
}

const apiBase = process.env.MIRACHAT_API_URL ?? 'http://127.0.0.1:4000'
const userId = process.env.MIRACHAT_USER_ID ?? process.env.USER_ID ?? 'demo-user'
const accountId = process.env.WHATSAPP_ACCOUNT_ID ?? 'whatsapp-account'
const port = Number(process.env.WHATSAPP_GATEWAY_PORT ?? 4011)
const pollMs = Number(process.env.WHATSAPP_POLL_MS ?? 5000)
const apiClient = createMirachatApiClient(apiBase)
const chromiumPath = resolveChromiumPath()
const authDir = resolve(mirachatRoot, '.wwebjs_auth')

let connectionStatus: ConnectionStatus = 'AUTH_REQUIRED'
let lastQrAt: string | null = null

const patchConnectionAuth = async (status: ConnectionStatus, qrPayload: string | null = null): Promise<void> => {
  connectionStatus = status
  if (qrPayload) {
    lastQrAt = new Date().toISOString()
  } else if (status === 'ONLINE') {
    lastQrAt = null
  }

  await apiClient.patchConnectionAuth({
    channel: 'whatsapp',
    accountId,
    userId,
    status,
    qrPayload,
  }).catch((error: unknown) => {
    console.error('whatsapp auth patch failed', error)
  })
}

const postMirachatInbound = async (message: {
  from: string
  body: string
  id: { _serialized?: string }
  fromMe?: boolean
}): Promise<void> => {
  if (message.fromMe) {
    return
  }

  const text = message.body.trim()
  if (!text) {
    return
  }

  await apiClient.postInbound({
    channel: 'whatsapp',
    accountId,
    userId,
    contactId: message.from,
    roomId: null,
    threadId: message.from,
    text,
    senderId: message.from,
    messageId: message.id._serialized ?? `wa-${Date.now()}`,
  })
}

const sendWhatsappOutbound = async (client: Client, item: { threadId: string; text: string }): Promise<void> => {
  await client.sendMessage(item.threadId, item.text)
}

const pollPendingSends = async (client: Client): Promise<void> => {
  if (connectionStatus !== 'ONLINE') {
    return
  }

  const items = await apiClient.fetchPendingSend('whatsapp', accountId)
  for (const item of items) {
    try {
      await sendWhatsappOutbound(client, item)
      const marked = await apiClient.markDraftSent(item.id)
      if (!marked) {
        console.error('whatsapp mark-sent rejected', item.id)
      }
    } catch (error) {
      console.error('whatsapp send failed', item.id, error)
    }
  }
}

const client = new Client({
  authStrategy: new LocalAuth({
    clientId: userId,
    dataPath: authDir,
  }),
  puppeteer: {
    executablePath: chromiumPath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
})

client.on('qr', qr => {
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(qr)}`
  console.log('whatsapp gateway qr', qrUrl)
  void patchConnectionAuth('AUTH_REQUIRED', qr)
})

client.on('authenticated', () => {
  console.log('whatsapp gateway authenticated')
})

client.on('ready', () => {
  console.log('whatsapp gateway ready')
  void patchConnectionAuth('ONLINE')
})

client.on('message', async message => {
  try {
    await postMirachatInbound(message)
  } catch (error) {
    console.error('whatsapp inbound forwarding failed', error)
  }
})

client.on('auth_failure', error => {
  console.error('whatsapp auth failure', error)
  void patchConnectionAuth('AUTH_REQUIRED')
})

client.on('disconnected', reason => {
  console.error('whatsapp disconnected', reason)
  void patchConnectionAuth('OFFLINE')
})

client.initialize().catch(error => {
  console.error('failed to initialize whatsapp gateway', error)
  void patchConnectionAuth('OFFLINE')
})

setInterval(() => {
  void pollPendingSends(client)
}, pollMs)

createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
  if (request.method === 'GET' && url.pathname === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(
      JSON.stringify(
        buildGatewayHealth({
          service: 'gateway-whatsapp',
          channel: 'whatsapp',
          configured: true,
          connectionStatus,
          accountId,
          apiBase,
          mode: 'local-auth',
          webhookPath: null,
          diagnostics: { pollMs, lastQrAt },
        }),
      ),
    )
    return
  }

  response.writeHead(404, { 'content-type': 'text/plain' })
  response.end('not found')
}).listen(port, () => {
  console.log(`gateway-whatsapp listening on http://localhost:${port}`)
})

const shutdown = async (signal: string) => {
  console.log(`whatsapp gateway shutting down (${signal})`)
  await patchConnectionAuth('OFFLINE')
  await client.destroy().catch(error => {
    console.error('failed to destroy whatsapp client', error)
  })
  process.exit(0)
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void shutdown(signal)
  })
}
