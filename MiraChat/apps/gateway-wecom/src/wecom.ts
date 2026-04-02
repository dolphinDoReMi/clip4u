import { createDecipheriv, createHash } from 'node:crypto'

export interface WeComCryptoConfig {
  token: string
  encodingAesKey: string
  corpId: string
}

export interface WeComCallbackQuery {
  msg_signature?: string
  timestamp?: string
  nonce?: string
  echostr?: string
}

export interface NormalizedWeComMessage {
  contactId: string
  roomId: string | null
  threadId: string
  senderId: string
  text: string
  messageId: string | null
}

export interface WeComAccessTokenResponse {
  accessToken: string
  expiresInSeconds: number
}

const extractXmlField = (xml: string, field: string): string | null => {
  const patterns = [
    new RegExp(`<${field}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${field}>`, 'i'),
    new RegExp(`<${field}>([^<]*)<\\/${field}>`, 'i'),
  ]
  for (const pattern of patterns) {
    const match = xml.match(pattern)
    if (match?.[1] != null) {
      return match[1]
    }
  }
  return null
}

const decodeAesKey = (encodingAesKey: string): Buffer => {
  const key = Buffer.from(`${encodingAesKey}=`, 'base64')
  if (key.length !== 32) {
    throw new Error('EncodingAESKey must decode to 32 bytes')
  }
  return key
}

const stripPkcs7 = (buffer: Buffer): Buffer => {
  const pad = buffer[buffer.length - 1] ?? 0
  if (pad < 1 || pad > 32) {
    return buffer
  }
  return buffer.subarray(0, buffer.length - pad)
}

export const computeWeComSignature = (
  token: string,
  timestamp: string,
  nonce: string,
  encrypted: string,
): string =>
  createHash('sha1')
    .update([token, timestamp, nonce, encrypted].sort().join(''))
    .digest('hex')

export const decryptWeComPayload = (
  encrypted: string,
  config: Pick<WeComCryptoConfig, 'encodingAesKey' | 'corpId'>,
): string => {
  const key = decodeAesKey(config.encodingAesKey)
  const decipher = createDecipheriv('aes-256-cbc', key, key.subarray(0, 16))
  decipher.setAutoPadding(false)
  const decrypted = stripPkcs7(Buffer.concat([decipher.update(encrypted, 'base64'), decipher.final()]))
  const xmlLength = decrypted.readUInt32BE(16)
  const xmlStart = 20
  const xmlEnd = xmlStart + xmlLength
  const xml = decrypted.subarray(xmlStart, xmlEnd).toString('utf8')
  const corpId = decrypted.subarray(xmlEnd).toString('utf8')
  if (corpId !== config.corpId) {
    throw new Error('WeCom CorpID mismatch during decrypt')
  }
  return xml
}

export const verifyWeComSignature = (
  encrypted: string,
  query: WeComCallbackQuery,
  config: Pick<WeComCryptoConfig, 'token'>,
): boolean => {
  if (!query.msg_signature || !query.timestamp || !query.nonce) {
    return false
  }
  return computeWeComSignature(config.token, query.timestamp, query.nonce, encrypted) === query.msg_signature
}

export const parseWeComEncryptedMessage = (
  bodyXml: string,
  query: WeComCallbackQuery,
  config: WeComCryptoConfig,
): string => {
  const encrypted = extractXmlField(bodyXml, 'Encrypt')
  if (!encrypted) {
    throw new Error('Encrypt field missing in WeCom callback')
  }
  if (!verifyWeComSignature(encrypted, query, config)) {
    throw new Error('Invalid WeCom callback signature')
  }
  return decryptWeComPayload(encrypted, config)
}

export const parseWeComVerificationEcho = (
  query: WeComCallbackQuery,
  config: WeComCryptoConfig,
): string => {
  if (!query.echostr) {
    throw new Error('echostr missing')
  }
  if (!verifyWeComSignature(query.echostr, query, config)) {
    throw new Error('Invalid WeCom verification signature')
  }
  return decryptWeComPayload(query.echostr, config)
}

export const normalizeWeComInbound = (xml: string): NormalizedWeComMessage | null => {
  const msgType = extractXmlField(xml, 'MsgType')
  if (msgType !== 'text') {
    return null
  }

  const text = (extractXmlField(xml, 'Content') ?? '').trim()
  if (!text) {
    return null
  }

  const senderId = extractXmlField(xml, 'FromUserName') ?? 'unknown'
  const externalUserId = extractXmlField(xml, 'ExternalUserID')
  const chatId = extractXmlField(xml, 'ChatId')
  const conversationId = extractXmlField(xml, 'ConversationId')
  const threadId = conversationId ?? chatId ?? externalUserId ?? senderId

  return {
    contactId: externalUserId ?? senderId,
    roomId: chatId ?? null,
    threadId,
    senderId,
    text,
    messageId: extractXmlField(xml, 'MsgId'),
  }
}

export const fetchWeComAccessToken = async (input: {
  corpId: string
  corpSecret: string
}): Promise<WeComAccessTokenResponse> => {
  const url = new URL('https://qyapi.weixin.qq.com/cgi-bin/gettoken')
  url.searchParams.set('corpid', input.corpId)
  url.searchParams.set('corpsecret', input.corpSecret)
  const response = await fetch(url)
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok || json.errcode !== 0) {
    throw new Error(
      `wecom gettoken failed: ${
        typeof json.errmsg === 'string' ? json.errmsg : `status ${response.status}`
      }`,
    )
  }
  const accessToken = typeof json.access_token === 'string' ? json.access_token : ''
  const expiresInSeconds = typeof json.expires_in === 'number' ? json.expires_in : 7200
  if (!accessToken) {
    throw new Error('wecom gettoken response missing access_token')
  }
  return { accessToken, expiresInSeconds }
}

export class WeComAccessTokenCache {
  private current: { value: string; expiresAt: number } | null = null

  constructor(
    private readonly loader: () => Promise<WeComAccessTokenResponse>,
    private readonly now: () => number = Date.now,
  ) {}

  async get(): Promise<string> {
    const now = this.now()
    if (this.current && this.current.expiresAt > now + 60_000) {
      return this.current.value
    }
    const next = await this.loader()
    this.current = {
      value: next.accessToken,
      expiresAt: now + next.expiresInSeconds * 1000,
    }
    return next.accessToken
  }
}

export const sendWeComExternalContactText = async (input: {
  accessToken: string
  agentId: string
  externalUserId: string
  text: string
}): Promise<void> => {
  const url = new URL('https://qyapi.weixin.qq.com/cgi-bin/externalcontact/message/send')
  url.searchParams.set('access_token', input.accessToken)
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      touser: input.externalUserId,
      msgtype: 'text',
      agentid: input.agentId,
      text: { content: input.text },
    }),
  })
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok || json.errcode !== 0) {
    throw new Error(
      `wecom external send failed: ${
        typeof json.errmsg === 'string' ? json.errmsg : `status ${response.status}`
      }`,
    )
  }
}
