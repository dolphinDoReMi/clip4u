import { createHmac, timingSafeEqual } from 'node:crypto'

export interface MiniProgramCode2SessionResult {
  openId: string
  unionId: string | null
  sessionKey: string
}

export interface MiniProgramSessionPayload {
  openId: string
  unionId: string | null
  userId: string
  exp: number
}

export interface MiniProgramDraftCard {
  id: string
  threadId: string
  inboundText: string | null
  generatedText: string
  confidenceScore: number
  intentSummary: string | null
  threadSummary: string | null
  replyOptions: Array<{ label: string; text: string }>
  createdAt: string
}

const toBase64Url = (input: Buffer | string): string =>
  Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')

const fromBase64Url = (input: string): Buffer => {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4)
  return Buffer.from(padded, 'base64')
}

export const createMiniProgramSessionToken = (
  secret: string,
  payload: MiniProgramSessionPayload,
): string => {
  const encodedPayload = toBase64Url(JSON.stringify(payload))
  const signature = createHmac('sha256', secret).update(encodedPayload).digest()
  return `${encodedPayload}.${toBase64Url(signature)}`
}

export const verifyMiniProgramSessionToken = (
  secret: string,
  token: string,
  now = Date.now(),
): MiniProgramSessionPayload | null => {
  const [encodedPayload, encodedSignature] = token.split('.')
  if (!encodedPayload || !encodedSignature) {
    return null
  }

  const expected = createHmac('sha256', secret).update(encodedPayload).digest()
  const actual = fromBase64Url(encodedSignature)
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null
  }

  try {
    const payload = JSON.parse(fromBase64Url(encodedPayload).toString('utf8')) as MiniProgramSessionPayload
    if (!payload.userId || !payload.openId || !Number.isFinite(payload.exp) || payload.exp <= now) {
      return null
    }
    return payload
  } catch {
    return null
  }
}

export const exchangeMiniProgramCode = async (input: {
  appId: string
  appSecret: string
  code: string
}): Promise<MiniProgramCode2SessionResult | { error: string }> => {
  if (!input.appId || !input.appSecret) {
    return { error: 'MINI_PROGRAM_APP_ID and MINI_PROGRAM_APP_SECRET are required' }
  }

  const url = new URL('https://api.weixin.qq.com/sns/jscode2session')
  url.searchParams.set('appid', input.appId)
  url.searchParams.set('secret', input.appSecret)
  url.searchParams.set('js_code', input.code)
  url.searchParams.set('grant_type', 'authorization_code')

  const response = await fetch(url)
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>

  if (!response.ok || typeof json.errcode === 'number') {
    return {
      error:
        typeof json.errmsg === 'string'
          ? `code2Session failed: ${json.errmsg}`
          : `code2Session failed with status ${response.status}`,
    }
  }

  const openId = typeof json.openid === 'string' ? json.openid : ''
  const sessionKey = typeof json.session_key === 'string' ? json.session_key : ''
  if (!openId || !sessionKey) {
    return { error: 'code2Session response missing openid or session_key' }
  }

  return {
    openId,
    unionId: typeof json.unionid === 'string' ? json.unionid : null,
    sessionKey,
  }
}

export const mapDraftToMiniProgramCard = (draft: {
  id: string
  thread_id: string
  inbound_raw_text: string | null
  generated_text: string
  confidence_score: number
  intent_summary: string | null
  thread_summary: string | null
  reply_options: Array<{ label: string; text: string }> | null
  created_at: Date
}): MiniProgramDraftCard => ({
  id: draft.id,
  threadId: draft.thread_id,
  inboundText: draft.inbound_raw_text,
  generatedText: draft.generated_text,
  confidenceScore: draft.confidence_score,
  intentSummary: draft.intent_summary,
  threadSummary: draft.thread_summary,
  replyOptions: Array.isArray(draft.reply_options) ? draft.reply_options : [],
  createdAt: draft.created_at.toISOString(),
})
