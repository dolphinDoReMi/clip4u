import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'
import type { ChannelAdapter, OutboundCommand } from '@delegate-ai/adapter-types'
import { MemoryCard } from 'memory-card'

const mirachatRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const rootEnv = resolve(mirachatRoot, '.env')
if (existsSync(rootEnv)) {
  loadEnv({ path: rootEnv })
}
import { WechatyBuilder } from 'wechaty'
import { createInMemoryRuntime } from '@delegate-ai/agent-core'
import {
  createMirachatApiClient,
  createWechatGateway,
  resolveWechatSendTarget,
} from './gateway-core.js'

const apiBase = process.env.MIRACHAT_API_URL ?? 'http://127.0.0.1:4000'
const useMirachat =
  process.env.MIRACHAT_ENABLED === '1' || process.env.MIRACHAT_ENABLED === 'true'
const channel = 'wechat' as const
const accountId = process.env.WECHAT_ACCOUNT_ID ?? 'default-account'
const userId = process.env.USER_ID ?? 'demo-user'
const debounceMs = Number(process.env.WECHATY_DEBOUNCE_MS ?? 3000)
const pollMs = Number(process.env.WECHATY_POLL_MS ?? 5000)
const botName = process.env.WECHATY_NAME ?? 'mirachat-gateway'
const wechatStateDir = resolve(mirachatRoot, '.wechaty-state')

mkdirSync(wechatStateDir, { recursive: true })

const memory = new MemoryCard({
  name: resolve(wechatStateDir, botName),
  storageOptions: { type: 'file' },
})
await memory.load()

const runtime = useMirachat ? undefined : createInMemoryRuntime()

const wechatAdapter: ChannelAdapter = {
  channel: 'wechat',
  async send(command: OutboundCommand): Promise<void> {
    const target = await resolveWechatSendTarget(bot, command.threadId)
    if (!target) {
      throw new Error(`Could not find room/contact for thread ${command.threadId}`)
    }
    await target.target.say(command.text)
  },
}

runtime?.registerAdapter(wechatAdapter)

const bot = WechatyBuilder.build({
  memory,
  name: botName,
})
const gateway = createWechatGateway({
  config: {
    apiBase,
    useMirachat,
    channel,
    accountId,
    userId,
    botName,
    debounceMs,
    pollMs,
  },
  bot,
  apiClient: createMirachatApiClient(apiBase),
  runtime,
})

gateway.startPolling()

bot.on('scan', (qrcode, status) => {
  void gateway.handleScan(qrcode, status).catch(error => {
    console.error('wechaty scan handler failed', error)
  })
})

bot.on('login', user => {
  void gateway.handleLogin(user).catch(error => {
    console.error('wechaty login handler failed', error)
  })
})

bot.on('logout', user => {
  void gateway.handleLogout(user).catch(error => {
    console.error('wechaty logout handler failed', error)
  })
})

bot.on('error', error => {
  gateway.handleError(error)
})

bot.on('message', async message => {
  await gateway.handleMessage(message)
})

const shutdown = async (signal: string) => {
  console.log(`wechat gateway shutting down (${signal})`)
  try {
    await gateway.stop('OFFLINE')
  } catch (error) {
    console.error('wechat gateway stop failed', error)
  }
  try {
    await bot.stop()
  } catch (error) {
    console.error('wechat gateway bot stop failed', error)
  }
  process.exit(0)
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void shutdown(signal)
  })
}

bot.start().catch(error => {
  console.error('failed to start wechat gateway', error)
  void gateway.stop('OFFLINE').catch(stopError => {
    console.error('wechat gateway offline patch failed', stopError)
  })
})
