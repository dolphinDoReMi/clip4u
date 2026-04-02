import {
  DelegationEventType,
  getOAuthAccount,
  insertDelegationEvent,
  insertMemoryChunks,
  upsertOAuthAccount,
} from '@delegate-ai/db'
import type { Pool } from 'pg'

const formEncode = (r: Record<string, string>) => new URLSearchParams(r).toString()

export function googleAuthorizeUrl(userId: string): { url: string } | { error: string } {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim()
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim()
  if (!clientId || !redirectUri) {
    return { error: 'Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_REDIRECT_URI in .env' }
  }
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  u.searchParams.set('client_id', clientId)
  u.searchParams.set('redirect_uri', redirectUri)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('scope', 'https://www.googleapis.com/auth/gmail.readonly')
  u.searchParams.set('access_type', 'offline')
  u.searchParams.set('prompt', 'consent')
  u.searchParams.set('state', encodeURIComponent(userId))
  return { url: u.toString() }
}

export async function googleOAuthCallback(
  pool: Pool,
  query: URLSearchParams,
): Promise<{ ok: true; userId: string } | { error: string }> {
  const code = query.get('code')
  const userId = query.get('state') ? decodeURIComponent(query.get('state')!) : ''
  if (!code || !userId) {
    return { error: 'missing code or state (userId)' }
  }
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim()
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim()
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim()
  if (!clientId || !clientSecret || !redirectUri) {
    return { error: 'Google OAuth env not configured' }
  }
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: formEncode({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })
  const tokenJson = (await tokenRes.json()) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    scope?: string
  }
  if (!tokenRes.ok || !tokenJson.access_token) {
    return { error: `token exchange failed: ${JSON.stringify(tokenJson)}` }
  }
  const expiresAt = tokenJson.expires_in
    ? new Date(Date.now() + tokenJson.expires_in * 1000)
    : null
  await upsertOAuthAccount(pool, {
    userId,
    provider: 'google_gmail',
    accessToken: tokenJson.access_token,
    refreshToken: tokenJson.refresh_token ?? null,
    expiresAt,
    scope: tokenJson.scope ?? null,
    externalSubject: 'gmail',
  })
  void insertDelegationEvent(pool, {
    eventType: DelegationEventType.OauthConnected,
    userId,
    metadata: { provider: 'google_gmail' },
  }).catch(() => {})
  return { ok: true, userId }
}

export function slackAuthorizeUrl(userId: string): { url: string } | { error: string } {
  const clientId = process.env.SLACK_OAUTH_CLIENT_ID?.trim()
  const redirectUri = process.env.SLACK_OAUTH_REDIRECT_URI?.trim()
  if (!clientId || !redirectUri) {
    return { error: 'Set SLACK_OAUTH_CLIENT_ID and SLACK_OAUTH_REDIRECT_URI in .env' }
  }
  const u = new URL('https://slack.com/oauth/v2/authorize')
  u.searchParams.set('client_id', clientId)
  u.searchParams.set('redirect_uri', redirectUri)
  u.searchParams.set('scope', 'channels:history,channels:read,users:read,chat:write')
  u.searchParams.set('state', encodeURIComponent(userId))
  return { url: u.toString() }
}

export async function slackOAuthCallback(
  pool: Pool,
  query: URLSearchParams,
): Promise<{ ok: true; userId: string } | { error: string }> {
  const code = query.get('code')
  const userId = query.get('state') ? decodeURIComponent(query.get('state')!) : ''
  if (!code || !userId) {
    return { error: 'missing code or state' }
  }
  const clientId = process.env.SLACK_OAUTH_CLIENT_ID?.trim()
  const clientSecret = process.env.SLACK_OAUTH_CLIENT_SECRET?.trim()
  const redirectUri = process.env.SLACK_OAUTH_REDIRECT_URI?.trim()
  if (!clientId || !clientSecret || !redirectUri) {
    return { error: 'Slack OAuth env not configured' }
  }
  const tokenRes = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: formEncode({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    }),
  })
  const tokenJson = (await tokenRes.json()) as {
    ok?: boolean
    access_token?: string
    refresh_token?: string
    expires_in?: number
    team?: { id?: string; name?: string }
    authed_user?: { id?: string }
    error?: string
  }
  if (!tokenJson.ok || !tokenJson.access_token) {
    return { error: tokenJson.error ?? 'slack oauth failed' }
  }
  const expiresAt = tokenJson.expires_in
    ? new Date(Date.now() + tokenJson.expires_in * 1000)
    : null
  await upsertOAuthAccount(pool, {
    userId,
    provider: 'slack',
    accessToken: tokenJson.access_token,
    refreshToken: tokenJson.refresh_token ?? null,
    expiresAt,
    scope: null,
    externalSubject: tokenJson.team?.id ?? tokenJson.authed_user?.id ?? 'slack',
  })
  void insertDelegationEvent(pool, {
    eventType: DelegationEventType.OauthConnected,
    userId,
    metadata: { provider: 'slack', team: tokenJson.team?.name },
  }).catch(() => {})
  return { ok: true, userId }
}

export async function ingestGmailIntoMemory(
  pool: Pool,
  userId: string,
  maxMessages = 15,
): Promise<{ inserted: number } | { error: string }> {
  const row = await getOAuthAccount(pool, userId, 'google_gmail')
  if (!row) {
    return { error: 'No google_gmail OAuth token; connect via /oauth/google/start' }
  }
  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxMessages}`,
    { headers: { Authorization: `Bearer ${row.access_token}` } },
  )
  const listJson = (await listRes.json()) as { messages?: { id: string }[]; error?: { message: string } }
  if (!listRes.ok || listJson.error) {
    return { error: listJson.error?.message ?? `gmail list ${listRes.status}` }
  }
  const ids = listJson.messages?.map(m => m.id) ?? []
  const contents: string[] = []
  for (const id of ids.slice(0, maxMessages)) {
    const mRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Subject`, {
      headers: { Authorization: `Bearer ${row.access_token}` },
    })
    const m = (await mRes.json()) as { snippet?: string; payload?: { headers?: { name: string; value: string }[] } }
    const subj = m.payload?.headers?.find(h => h.name.toLowerCase() === 'subject')?.value ?? ''
    const line = `[gmail] ${subj ? `${subj} — ` : ''}${(m.snippet ?? '').slice(0, 500)}`
    contents.push(line)
  }
  const inserted = await insertMemoryChunks(pool, { userId, threadId: `gmail:${userId}`, contents })
  void insertDelegationEvent(pool, {
    eventType: DelegationEventType.IngestCompleted,
    userId,
    metadata: { provider: 'google_gmail', inserted },
  }).catch(() => {})
  return { inserted }
}

export async function ingestSlackIntoMemory(
  pool: Pool,
  userId: string,
  channelId: string,
  maxMessages = 20,
): Promise<{ inserted: number } | { error: string }> {
  const row = await getOAuthAccount(pool, userId, 'slack')
  if (!row) {
    return { error: 'No slack OAuth token; connect via /oauth/slack/start' }
  }
  const histRes = await fetch('https://slack.com/api/conversations.history', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${row.access_token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ channel: channelId, limit: maxMessages }),
  })
  const hist = (await histRes.json()) as {
    ok?: boolean
    messages?: { text?: string; user?: string }[]
    error?: string
  }
  if (!hist.ok) {
    return { error: hist.error ?? 'slack history failed' }
  }
  const contents = (hist.messages ?? [])
    .map(m => `[slack:${channelId}] ${m.user ?? '?'}: ${(m.text ?? '').slice(0, 600)}`)
    .filter(Boolean)
  const inserted = await insertMemoryChunks(pool, { userId, threadId: `slack:${channelId}`, contents })
  void insertDelegationEvent(pool, {
    eventType: DelegationEventType.IngestCompleted,
    userId,
    metadata: { provider: 'slack', channelId, inserted },
  }).catch(() => {})
  return { inserted }
}
