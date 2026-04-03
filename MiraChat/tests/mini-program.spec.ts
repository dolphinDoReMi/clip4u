import { createCipheriv, randomBytes } from 'node:crypto'
import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  createMiniProgramSessionToken,
  mapDraftToMiniProgramCard,
  verifyMiniProgramSessionToken,
} from '../services/api/src/mini-program.ts'
import {
  computeWeComSignature,
  fetchWeComAccessToken,
  decryptWeComPayload,
  normalizeWeComInbound,
  parseWeComVerificationEcho,
  sendWeComExternalContactText,
  WeComAccessTokenCache,
} from '../apps/gateway-wecom/src/wecom.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('mini program helpers', () => {
  it('creates and verifies a signed session token', () => {
    const token = createMiniProgramSessionToken('secret', {
      openId: 'openid-1',
      unionId: 'union-1',
      userId: 'demo-user',
      exp: Date.now() + 60_000,
    })

    const verified = verifyMiniProgramSessionToken('secret', token)
    expect(verified?.openId).toBe('openid-1')
    expect(verified?.userId).toBe('demo-user')
  })

  it('maps draft rows into mobile-friendly cards', () => {
    const card = mapDraftToMiniProgramCard({
      id: 'draft-1',
      thread_id: 'thread-1',
      inbound_raw_text: 'Inbound',
      generated_text: 'Generated',
      confidence_score: 0.82,
      intent_summary: 'Follow up',
      thread_summary: 'Summary',
      reply_options: [{ label: 'relationship-first', text: 'Hello there' }],
      created_at: new Date('2026-04-02T00:00:00.000Z'),
    })

    expect(card.replyOptions[0]?.label).toBe('relationship-first')
    expect(card.createdAt).toBe('2026-04-02T00:00:00.000Z')
  })
})

const encodeWeComXml = (xml: string, encodingAesKey: string, corpId: string): string => {
  const key = Buffer.from(`${encodingAesKey}=`, 'base64')
  const iv = key.subarray(0, 16)
  const random = randomBytes(16)
  const xmlBuffer = Buffer.from(xml)
  const length = Buffer.alloc(4)
  length.writeUInt32BE(xmlBuffer.length, 0)
  const corp = Buffer.from(corpId)
  const payload = Buffer.concat([random, length, xmlBuffer, corp])
  const remainder = payload.length % 32
  const padLength = remainder === 0 ? 32 : 32 - remainder
  const padded = Buffer.concat([payload, Buffer.alloc(padLength, padLength)])
  const cipher = createCipheriv('aes-256-cbc', key, iv)
  cipher.setAutoPadding(false)
  return Buffer.concat([cipher.update(padded), cipher.final()]).toString('base64')
}

describe('wecom helpers', () => {
  it('verifies and decrypts callback echoes', () => {
    const xml = '<xml><ToUserName><![CDATA[corp]]></ToUserName><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[hello]]></Content></xml>'
    const encodingAesKey = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG'
    const corpId = 'ww123'
    const encrypted = encodeWeComXml(xml, encodingAesKey, corpId)
    const timestamp = '1712000000'
    const nonce = 'nonce-1'
    const signature = computeWeComSignature('token-1', timestamp, nonce, encrypted)

    const echo = parseWeComVerificationEcho(
      {
        echostr: encrypted,
        timestamp,
        nonce,
        msg_signature: signature,
      },
      {
        token: 'token-1',
        encodingAesKey,
        corpId,
      },
    )

    expect(echo).toContain('<Content><![CDATA[hello]]></Content>')
    expect(decryptWeComPayload(encrypted, { encodingAesKey, corpId })).toBe(xml)
  })

  it('normalizes text inbound payloads', () => {
    const normalized = normalizeWeComInbound(`
      <xml>
        <FromUserName><![CDATA[zhangsan]]></FromUserName>
        <MsgType><![CDATA[text]]></MsgType>
        <Content><![CDATA[hello wecom]]></Content>
        <ExternalUserID><![CDATA[external-1]]></ExternalUserID>
        <ChatId><![CDATA[chat-1]]></ChatId>
        <MsgId>12345</MsgId>
      </xml>
    `)

    expect(normalized).toEqual({
      contactId: 'external-1',
      roomId: 'chat-1',
      threadId: 'chat-1',
      senderId: 'zhangsan',
      text: 'hello wecom',
      messageId: '12345',
    })
  })

  it('caches WeCom access tokens until near expiry', async () => {
    const loader = vi
      .fn()
      .mockResolvedValueOnce({ accessToken: 'tok-1', expiresInSeconds: 7200 })
      .mockResolvedValueOnce({ accessToken: 'tok-2', expiresInSeconds: 7200 })
    let now = 1_000
    const cache = new WeComAccessTokenCache(loader, () => now)

    await expect(cache.get()).resolves.toBe('tok-1')
    await expect(cache.get()).resolves.toBe('tok-1')
    now += 7_200_000
    await expect(cache.get()).resolves.toBe('tok-2')
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('fetches token and sends external contact text through official endpoints', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ errcode: 0, access_token: 'token-1', expires_in: 7200 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ errcode: 0 }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const token = await fetchWeComAccessToken({ corpId: 'ww123', corpSecret: 'secret-1' })
    expect(token.accessToken).toBe('token-1')

    await sendWeComExternalContactText({
      accessToken: token.accessToken,
      agentId: '1000002',
      externalUserId: 'external-1',
      text: 'hello official wecom',
    })

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/cgi-bin/gettoken?')
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/cgi-bin/externalcontact/message/send?access_token=token-1')
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: 'POST',
    })
  })
})
