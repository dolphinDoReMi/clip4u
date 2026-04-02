import { createPluginRegistry } from '@delegate-ai/gateway-runtime'
import type { TwilioGatewayConfig } from './config.js'
import { createProgrammableMessagingPlugin } from './plugins/programmable-messaging.js'
import { createConversationsPlugin } from './plugins/conversations.js'
import type { TwilioChannel, TwilioTransportPlugin } from './plugin-types.js'

export const createTwilioPluginRegistry = (config: TwilioGatewayConfig) => {
  const factories: Record<string, () => TwilioTransportPlugin> = {
    'programmable-messaging': () => createProgrammableMessagingPlugin(config),
    conversations: () => createConversationsPlugin(config),
  }

  return createPluginRegistry<TwilioChannel, TwilioTransportPlugin>({
    routing: config.pluginByChannel,
    factories,
  })
}
