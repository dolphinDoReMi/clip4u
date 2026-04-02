export interface TransportPlugin<TChannel extends string, TItem> {
  id: string
  supports(channel: TChannel): boolean
  isConfigured(): boolean
  send(item: TItem): Promise<void>
  health(): Record<string, unknown>
}

export interface PluginRegistry<TChannel extends string, TPlugin extends TransportPlugin<TChannel, unknown>> {
  resolve(channel: TChannel): TPlugin
  isConfigured(): boolean
  health(): GatewayPluginHealth
}

export type GatewayPluginHealth = {
  channelRouting: Record<string, string>
  plugins: Array<{ id: string } & Record<string, unknown>>
}

export type GatewayHealthSnapshot = {
  ok: true
  service: string
  channel: string
  configured: boolean
  connectionStatus: 'ONLINE' | 'OFFLINE' | 'DEGRADED' | 'AUTH_REQUIRED'
  accountId: string | null
  apiBase: string
  mode: string | null
  webhookPath: string | null
  plugins?: GatewayPluginHealth | null
  diagnostics?: Record<string, unknown>
}

type PluginRegistryOptions<TChannel extends string, TPlugin extends TransportPlugin<TChannel, unknown>> = {
  routing: Record<TChannel, string>
  factories: Record<string, () => TPlugin>
}

const unique = <T>(values: T[]): T[] => [...new Set(values)]

export const createPluginRegistry = <
  TChannel extends string,
  TPlugin extends TransportPlugin<TChannel, unknown>,
>({
  routing,
  factories,
}: PluginRegistryOptions<TChannel, TPlugin>): PluginRegistry<TChannel, TPlugin> => {
  const plugins = new Map<string, TPlugin>()
  const pluginIds = unique<string>(Object.values(routing) as string[])

  for (const pluginId of pluginIds) {
    const factory = factories[pluginId]
    if (!factory) {
      throw new Error(`Unknown transport plugin "${pluginId}"`)
    }
    plugins.set(pluginId, factory())
  }

  return {
    resolve(channel) {
      const pluginId = routing[channel]
      const plugin = plugins.get(pluginId)
      if (!plugin) {
        throw new Error(`Transport plugin "${pluginId}" is not registered`)
      }
      if (!plugin.supports(channel)) {
        throw new Error(`Transport plugin "${pluginId}" does not support channel "${channel}"`)
      }
      return plugin
    },
    isConfigured() {
      return [...plugins.values()].some(plugin => plugin.isConfigured())
    },
    health() {
      return {
        channelRouting: routing,
        plugins: [...plugins.values()].map(plugin => ({
          id: plugin.id,
          ...plugin.health(),
        })),
      }
    },
  }
}

export const buildGatewayHealth = (
  input: Omit<GatewayHealthSnapshot, 'ok'>,
): GatewayHealthSnapshot => ({
  ok: true,
  ...input,
})

export type ConnectionStatus = 'ONLINE' | 'OFFLINE' | 'AUTH_REQUIRED'

export interface PendingSendItem {
  id: string
  threadId: string
  text: string
  channel?: string
  accountId?: string
  contactId?: string | null
  roomId?: string | null
}

export interface MirachatApiClient {
  patchConnectionAuth(input: {
    channel: string
    accountId: string
    userId: string
    status: ConnectionStatus
    qrPayload?: string | null
  }): Promise<void>
  postInbound(input: {
    channel: string
    accountId: string
    userId: string
    contactId: string
    roomId: string | null
    threadId: string
    text: string
    senderId: string
    messageId: string | null
    mentions?: string[]
  }): Promise<void>
  fetchPendingSend(channel: string, accountId: string): Promise<PendingSendItem[]>
  markDraftSent(id: string): Promise<boolean>
}

type MirachatApiLogger = Pick<Console, 'warn'>

const defaultMirachatApiLogger: MirachatApiLogger = console

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, '')

export const createMirachatApiClient = (
  apiBase: string,
  logger: MirachatApiLogger = defaultMirachatApiLogger,
): MirachatApiClient => {
  const base = trimTrailingSlash(apiBase)

  return {
    async patchConnectionAuth(input) {
      const response = await fetch(`${base}/mirachat/connection/auth`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      })

      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(`connection auth patch failed: ${response.status} ${text}`)
      }
    },

    async postInbound(input) {
      const response = await fetch(`${base}/mirachat/inbound`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      })

      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(`mirachat inbound failed: ${response.status} ${text}`)
      }
    },

    async fetchPendingSend(channel, accountId) {
      const response = await fetch(
        `${base}/mirachat/pending-send?channel=${encodeURIComponent(channel)}&accountId=${encodeURIComponent(accountId)}`,
      )
      if (!response.ok) {
        logger.warn('pending-send fetch returned non-OK', response.status)
        return []
      }
      return (await response.json()) as PendingSendItem[]
    },

    async markDraftSent(id) {
      const response = await fetch(`${base}/mirachat/drafts/${id}/mark-sent`, { method: 'POST' })
      if (!response.ok) {
        logger.warn('mark-sent failed', id, response.status)
        return false
      }
      return true
    },
  }
}
