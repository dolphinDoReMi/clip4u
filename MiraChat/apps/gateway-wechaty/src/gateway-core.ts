import type { MessageEvent } from '@delegate-ai/adapter-types'
import {
  createMirachatApiClient as createSharedMirachatApiClient,
  type ConnectionStatus,
  type MirachatApiClient,
  type PendingSendItem,
} from '@delegate-ai/gateway-runtime'

export interface GatewayConfig {
  apiBase: string
  useMirachat: boolean
  channel: 'wechat'
  accountId: string
  userId: string
  botName: string
  debounceMs: number
  pollMs: number
}

export interface GatewayLogger {
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

export interface WechatContactLike {
  id: string
  say(text: string): Promise<unknown>
}

export interface WechatRoomLike {
  id: string
  say(text: string): Promise<unknown>
}

export interface WechatBotLike {
  Contact: {
    find(query: { id: string }): Promise<WechatContactLike | null | undefined>
  }
  Room: {
    find(query: { id: string }): Promise<WechatRoomLike | null | undefined>
  }
}

export interface WechatUserLike {
  name(): string
}

export interface WechatMessageLike {
  id?: string
  self(): boolean
  text(): string
  talker(): { id: string }
  room(): { id: string } | null | undefined
  mentionList?(): Promise<Array<{ id: string }>>
}

export interface NormalizedWechatMessage {
  bufferKey: string
  contactId: string
  roomId: string | null
  threadId: string
  senderId: string
  text: string
  messageId: string | null
  mentions?: string[]
}

export interface GatewayRuntimeLike {
  handleMessage(event: MessageEvent): Promise<unknown>
}

const defaultLogger: GatewayLogger = {
  info: (...args) => console.log(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

export const createWechatBufferKey = (roomId: string | null, senderId: string): string =>
  roomId ? `${roomId}::${senderId}` : senderId

export const computeTypingDelay = (text: string, random = Math.random): number => {
  const base = 400 + Math.min(3500, text.length * 28)
  const jitter = Math.floor(random() * 500)
  return base + jitter
}

export const normalizeWechatMessage = async (
  message: WechatMessageLike,
): Promise<NormalizedWechatMessage | null> => {
  if (message.self()) {
    return null
  }

  const text = message.text().trim()
  if (!text) {
    return null
  }

  const room = message.room()
  const roomId = room?.id ?? null
  const senderId = message.talker().id
  const mentions =
    room && typeof message.mentionList === 'function'
      ? (await message.mentionList()).map(contact => contact.id).filter(Boolean)
      : undefined

  return {
    bufferKey: createWechatBufferKey(roomId, senderId),
    contactId: senderId,
    roomId,
    threadId: roomId ?? senderId,
    senderId,
    text,
    messageId: message.id ?? null,
    mentions: mentions?.length ? mentions : undefined,
  }
}

export const toMessageEvent = (
  config: GatewayConfig,
  message: NormalizedWechatMessage,
  now = Date.now(),
): MessageEvent => ({
  channel: config.channel,
  accountId: config.accountId,
  userId: config.userId,
  senderId: message.senderId,
  threadId: message.threadId,
  messageId: message.messageId ?? `${config.channel}-${now}`,
  text: message.text,
  timestamp: now,
  threadType: message.roomId ? 'group' : 'dm',
  mentions: message.mentions,
})

export const resolveWechatSendTarget = async (
  bot: WechatBotLike,
  threadId: string,
): Promise<{ kind: 'room' | 'contact'; target: WechatRoomLike | WechatContactLike } | null> => {
  const room = await bot.Room.find({ id: threadId })
  if (room) {
    return { kind: 'room', target: room }
  }

  const contact = await bot.Contact.find({ id: threadId })
  if (contact) {
    return { kind: 'contact', target: contact }
  }

  return null
}

export const deliverPendingDrafts = async (
  bot: WechatBotLike,
  apiClient: MirachatApiClient,
  drafts: PendingSendItem[],
  options?: {
    logger?: GatewayLogger
    inFlightDraftIds?: Set<string>
    random?: () => number
    sleepFn?: (ms: number) => Promise<void>
  },
): Promise<void> => {
  const logger = options?.logger ?? defaultLogger
  const inFlightDraftIds = options?.inFlightDraftIds
  const random = options?.random ?? Math.random
  const sleepFn = options?.sleepFn ?? sleep

  for (const draft of drafts) {
    if (inFlightDraftIds?.has(draft.id)) {
      continue
    }

    inFlightDraftIds?.add(draft.id)
    try {
      await sleepFn(computeTypingDelay(draft.text, random))
      const resolved = await resolveWechatSendTarget(bot, draft.threadId)
      if (!resolved) {
        logger.warn('pending-send: no room/contact for thread', draft.threadId)
        continue
      }

      await resolved.target.say(draft.text)
      const marked = await apiClient.markDraftSent(draft.id)
      if (!marked) {
        logger.warn('pending-send: mark-sent rejected', draft.id)
      }
    } catch (error) {
      logger.error('pending-send actuation failed', draft.id, error)
    } finally {
      inFlightDraftIds?.delete(draft.id)
    }
  }
}

type BufferedInbound = {
  timer: ReturnType<typeof setTimeout> | null
  payload: {
    contactId: string
    roomId: string | null
    threadId: string
    senderId: string
    parts: string[]
    messageId: string | null
    mentions: Set<string>
  }
}

export const createWechatGateway = (input: {
  config: GatewayConfig
  bot: WechatBotLike
  apiClient: MirachatApiClient
  runtime?: GatewayRuntimeLike
  logger?: GatewayLogger
}) => {
  const { config, bot, apiClient, runtime } = input
  const logger = input.logger ?? defaultLogger
  const inFlightDraftIds = new Set<string>()
  const buffers = new Map<string, BufferedInbound>()
  let pollTimer: ReturnType<typeof setInterval> | null = null

  const flushInbound = async (bufferKey: string) => {
    const entry = buffers.get(bufferKey)
    if (!entry) {
      return
    }
    buffers.delete(bufferKey)

    const text = entry.payload.parts.join('\n').trim()
    if (!text) {
      return
    }

    await apiClient.postInbound({
      channel: config.channel,
      accountId: config.accountId,
      userId: config.userId,
      contactId: entry.payload.contactId,
      roomId: entry.payload.roomId,
      threadId: entry.payload.threadId,
      text,
      senderId: entry.payload.senderId,
      messageId: entry.payload.messageId,
      mentions: entry.payload.mentions.size ? [...entry.payload.mentions] : undefined,
    })
  }

  const scheduleInbound = (message: NormalizedWechatMessage) => {
    let entry = buffers.get(message.bufferKey)
    if (!entry) {
      entry = {
        timer: null,
        payload: {
          contactId: message.contactId,
          roomId: message.roomId,
          threadId: message.threadId,
          senderId: message.senderId,
          parts: [],
          messageId: message.messageId,
          mentions: new Set<string>(),
        },
      }
      buffers.set(message.bufferKey, entry)
    }

    entry.payload.contactId = message.contactId
    entry.payload.roomId = message.roomId
    entry.payload.threadId = message.threadId
    entry.payload.senderId = message.senderId
    entry.payload.messageId = message.messageId
    entry.payload.parts.push(message.text)
    for (const mentionId of message.mentions ?? []) {
      entry.payload.mentions.add(mentionId)
    }

    if (entry.timer) {
      clearTimeout(entry.timer)
    }

    entry.timer = setTimeout(() => {
      void flushInbound(message.bufferKey).catch(error => {
        logger.error('mirachat inbound flush failed', error)
      })
    }, config.debounceMs)
  }

  const flushAllInbound = async () => {
    const keys = [...buffers.keys()]
    for (const key of keys) {
      const entry = buffers.get(key)
      if (entry?.timer) {
        clearTimeout(entry.timer)
      }
      try {
        await flushInbound(key)
      } catch (error) {
        logger.error('mirachat inbound flush failed', error)
      }
    }
  }

  const pollPendingSend = async () => {
    if (!config.useMirachat) {
      return
    }

    try {
      const drafts = await apiClient.fetchPendingSend(config.channel, config.accountId)
      await deliverPendingDrafts(bot, apiClient, drafts, { logger, inFlightDraftIds })
    } catch (error) {
      logger.error('mirachat pending-send fetch failed', error)
    }
  }

  return {
    async handleScan(qrcode: string, status: unknown) {
      logger.info('wechaty scan', status, qrcode)
      if (config.useMirachat) {
        await apiClient.patchConnectionAuth({
          channel: config.channel,
          accountId: config.accountId,
          userId: config.userId,
          status: 'AUTH_REQUIRED',
          qrPayload: qrcode,
        })
      }
    },

    async handleLogin(user: WechatUserLike) {
      logger.info(`${user.name()} logged in to wechat gateway`)
      if (config.useMirachat) {
        await apiClient.patchConnectionAuth({
          channel: config.channel,
          accountId: config.accountId,
          userId: config.userId,
          status: 'ONLINE',
        })
      }
    },

    async handleLogout(user: WechatUserLike) {
      logger.info(`${user.name()} logged out of wechat gateway`)
      if (config.useMirachat) {
        await apiClient.patchConnectionAuth({
          channel: config.channel,
          accountId: config.accountId,
          userId: config.userId,
          status: 'AUTH_REQUIRED',
        })
      }
    },

    handleError(error: unknown) {
      logger.error('wechat gateway error', error)
    },

    async handleMessage(message: WechatMessageLike) {
      const normalized = await normalizeWechatMessage(message)
      if (!normalized) {
        return
      }

      if (config.useMirachat) {
        scheduleInbound(normalized)
        return
      }

      if (!runtime) {
        throw new Error('Gateway runtime is required when MIRACHAT is disabled')
      }

      await runtime.handleMessage(toMessageEvent(config, normalized))
    },

    startPolling() {
      if (!config.useMirachat || pollTimer) {
        return
      }
      pollTimer = setInterval(() => {
        void pollPendingSend()
      }, config.pollMs)
    },

    async stop(status: ConnectionStatus = 'OFFLINE') {
      if (pollTimer) {
        clearInterval(pollTimer)
        pollTimer = null
      }
      await flushAllInbound()
      if (config.useMirachat) {
        await apiClient.patchConnectionAuth({
          channel: config.channel,
          accountId: config.accountId,
          userId: config.userId,
          status,
        })
      }
    },

    async pollPendingSendNow() {
      await pollPendingSend()
    },
  }
}

export const createMirachatApiClient = (apiBase: string, logger: GatewayLogger = defaultLogger): MirachatApiClient =>
  createSharedMirachatApiClient(apiBase, logger)
