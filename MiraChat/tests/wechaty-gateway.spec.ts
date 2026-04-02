import { describe, expect, it, vi } from 'vitest'
import {
  createWechatGateway,
  deliverPendingDrafts,
  normalizeWechatMessage,
} from '../apps/gateway-wechaty/src/gateway-core.ts'

describe('wechaty gateway helpers', () => {
  it('normalizes room messages with room thread id and mentions', async () => {
    const normalized = await normalizeWechatMessage({
      id: 'msg-1',
      self: () => false,
      text: () => 'Hello room',
      talker: () => ({ id: 'contact-1' }),
      room: () => ({ id: 'room-1' }),
      mentionList: async () => [{ id: 'u-1' }, { id: 'u-2' }],
    })

    expect(normalized).toEqual({
      bufferKey: 'room-1::contact-1',
      contactId: 'contact-1',
      roomId: 'room-1',
      threadId: 'room-1',
      senderId: 'contact-1',
      text: 'Hello room',
      messageId: 'msg-1',
      mentions: ['u-1', 'u-2'],
    })
  })

  it('flushes grouped inbound separately per sender within the same room', async () => {
    const postInbound = vi.fn().mockResolvedValue(undefined)
    const patchConnectionAuth = vi.fn().mockResolvedValue(undefined)
    const gateway = createWechatGateway({
      config: {
        apiBase: 'http://127.0.0.1:4000',
        useMirachat: true,
        channel: 'wechat',
        accountId: 'wechat-account',
        userId: 'demo-user',
        botName: 'mirachat-gateway',
        debounceMs: 60_000,
        pollMs: 5_000,
      },
      bot: {
        Room: { find: vi.fn().mockResolvedValue(null) },
        Contact: { find: vi.fn().mockResolvedValue(null) },
      },
      apiClient: {
        patchConnectionAuth,
        postInbound,
        fetchPendingSend: vi.fn().mockResolvedValue([]),
        markDraftSent: vi.fn().mockResolvedValue(true),
      },
    })

    await gateway.handleMessage({
      id: 'msg-a',
      self: () => false,
      text: () => 'first from alice',
      talker: () => ({ id: 'alice' }),
      room: () => ({ id: 'room-1' }),
      mentionList: async () => [],
    })
    await gateway.handleMessage({
      id: 'msg-b',
      self: () => false,
      text: () => 'first from bob',
      talker: () => ({ id: 'bob' }),
      room: () => ({ id: 'room-1' }),
      mentionList: async () => [],
    })
    await gateway.handleMessage({
      id: 'msg-c',
      self: () => false,
      text: () => 'second from alice',
      talker: () => ({ id: 'alice' }),
      room: () => ({ id: 'room-1' }),
      mentionList: async () => [],
    })

    await gateway.stop('OFFLINE')

    expect(postInbound).toHaveBeenCalledTimes(2)
    expect(postInbound).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        contactId: 'alice',
        roomId: 'room-1',
        threadId: 'room-1',
        senderId: 'alice',
        text: 'first from alice\nsecond from alice',
      }),
    )
    expect(postInbound).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        contactId: 'bob',
        roomId: 'room-1',
        threadId: 'room-1',
        senderId: 'bob',
        text: 'first from bob',
      }),
    )
    expect(patchConnectionAuth).toHaveBeenCalledWith({
      channel: 'wechat',
      accountId: 'wechat-account',
      userId: 'demo-user',
      status: 'OFFLINE',
    })
  })

  it('delivers pending drafts to rooms before contacts and marks them sent', async () => {
    const roomSay = vi.fn().mockResolvedValue(undefined)
    const contactSay = vi.fn().mockResolvedValue(undefined)
    const markDraftSent = vi.fn().mockResolvedValue(true)

    await deliverPendingDrafts(
      {
        Room: {
          find: vi.fn(async ({ id }: { id: string }) => (id === 'room-1' ? { id, say: roomSay } : null)),
        },
        Contact: {
          find: vi.fn(async ({ id }: { id: string }) => (id === 'contact-1' ? { id, say: contactSay } : null)),
        },
      },
      {
        patchConnectionAuth: vi.fn().mockResolvedValue(undefined),
        postInbound: vi.fn().mockResolvedValue(undefined),
        fetchPendingSend: vi.fn().mockResolvedValue([]),
        markDraftSent,
      },
      [
        { id: 'draft-1', threadId: 'room-1', text: 'Hello room' },
        { id: 'draft-2', threadId: 'contact-1', text: 'Hello contact' },
      ],
      {
        random: () => 0,
        sleepFn: async () => {},
      },
    )

    expect(roomSay).toHaveBeenCalledWith('Hello room')
    expect(contactSay).toHaveBeenCalledWith('Hello contact')
    expect(markDraftSent).toHaveBeenCalledTimes(2)
    expect(markDraftSent).toHaveBeenNthCalledWith(1, 'draft-1')
    expect(markDraftSent).toHaveBeenNthCalledWith(2, 'draft-2')
  })
})
