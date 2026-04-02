import { describe, expect, it } from 'vitest'
import { buildGatewayHealth, createPluginRegistry, type TransportPlugin } from '@delegate-ai/gateway-runtime'

describe('gateway runtime shared primitives', () => {
  it('resolves plugins by channel and reports shared health', () => {
    type Channel = 'alpha' | 'beta'
    type Item = { channel: Channel; text: string }
    type Plugin = TransportPlugin<Channel, Item>

    const alphaPlugin: Plugin = {
      id: 'alpha-plugin',
      supports: channel => channel === 'alpha',
      isConfigured: () => true,
      send: async () => undefined,
      health: () => ({ kind: 'alpha' }),
    }
    const betaPlugin: Plugin = {
      id: 'beta-plugin',
      supports: channel => channel === 'beta',
      isConfigured: () => false,
      send: async () => undefined,
      health: () => ({ kind: 'beta' }),
    }

    const registry = createPluginRegistry<Channel, Plugin>({
      routing: { alpha: 'alpha-plugin', beta: 'beta-plugin' },
      factories: {
        'alpha-plugin': () => alphaPlugin,
        'beta-plugin': () => betaPlugin,
      },
    })

    expect(registry.resolve('alpha').id).toBe('alpha-plugin')
    expect(registry.resolve('beta').id).toBe('beta-plugin')
    expect(registry.isConfigured()).toBe(true)
    expect(registry.health()).toEqual({
      channelRouting: { alpha: 'alpha-plugin', beta: 'beta-plugin' },
      plugins: [
        { id: 'alpha-plugin', kind: 'alpha' },
        { id: 'beta-plugin', kind: 'beta' },
      ],
    })
  })

  it('builds a unified gateway health snapshot', () => {
    expect(
      buildGatewayHealth({
        service: 'gateway-example',
        channel: 'example',
        configured: true,
        connectionStatus: 'ONLINE',
        accountId: 'acct-1',
        apiBase: 'http://127.0.0.1:4000',
        mode: 'polling',
        webhookPath: '/webhooks/example',
        diagnostics: { foo: 'bar' },
      }),
    ).toEqual({
      ok: true,
      service: 'gateway-example',
      channel: 'example',
      configured: true,
      connectionStatus: 'ONLINE',
      accountId: 'acct-1',
      apiBase: 'http://127.0.0.1:4000',
      mode: 'polling',
      webhookPath: '/webhooks/example',
      diagnostics: { foo: 'bar' },
    })
  })
})
