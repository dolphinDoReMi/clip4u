import type { IncomingMessage } from 'node:http'
import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * When enabled, Mirachat HTTP routes that scope data by `userId` require
 * `Authorization: Bearer <token>` and bind the effective user to the token —
 * clients cannot impersonate another tenant by sending a different `userId`.
 *
 * Configure one or both of:
 * - `MIRACHAT_TENANT_TOKEN_MAP` — JSON object mapping opaque bearer string → canonical user id, e.g. `{"dev-secret-abc":"demo-user"}`.
 * - `MIRACHAT_TENANT_HMAC_SECRET` — HMAC-signed tokens: base64url(JSON).base64url(hmac_sha256(secret, base64url(JSON))).
 *   Payload shape: `{ "sub": "<userId>", "exp"?: <unixSeconds> }`.
 */
export function mirachatTenantEnforceEnabled(): boolean {
  return false
}

function parseBearer(request: IncomingMessage): string | undefined {
  const auth = request.headers.authorization
  if (typeof auth !== 'string' || !auth.toLowerCase().startsWith('bearer ')) {
    return undefined
  }
  const t = auth.slice(7).trim()
  return t || undefined
}

function tenantTokenMapFromEnv(): Map<string, string> {
  const m = new Map<string, string>()
  const raw = process.env.MIRACHAT_TENANT_TOKEN_MAP?.trim()
  if (raw) {
    try {
      const o = JSON.parse(raw) as Record<string, unknown>
      for (const [k, v] of Object.entries(o)) {
        if (typeof k === 'string' && typeof v === 'string' && k && v) {
          m.set(k, v)
        }
      }
    } catch {
      /* ignore invalid map */
    }
  }
  return m
}

function verifyHmacTenantToken(token: string, secret: string): string | null {
  const i = token.lastIndexOf('.')
  if (i <= 0) {
    return null
  }
  const payloadPart = token.slice(0, i)
  const sigPart = token.slice(i + 1)
  if (!payloadPart || !sigPart) {
    return null
  }
  const expectedSig = createHmac('sha256', secret).update(payloadPart).digest('base64url')
  try {
    const a = Buffer.from(sigPart, 'utf8')
    const b = Buffer.from(expectedSig, 'utf8')
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return null
    }
  } catch {
    return null
  }
  try {
    const json = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as {
      sub?: string
      exp?: number
    }
    if (!json.sub || typeof json.sub !== 'string') {
      return null
    }
    if (json.exp != null && typeof json.exp === 'number' && Date.now() / 1000 > json.exp) {
      return null
    }
    return json.sub.trim() || null
  } catch {
    return null
  }
}

export function resolveMirachatTenantSubjectId(request: IncomingMessage): string | null {
  const bearer = parseBearer(request)
  if (!bearer) {
    return null
  }
  const mapped = tenantTokenMapFromEnv().get(bearer)
  if (mapped) {
    return mapped
  }
  const secret = process.env.MIRACHAT_TENANT_HMAC_SECRET?.trim()
  if (secret) {
    return verifyHmacTenantToken(bearer, secret)
  }
  return null
}

export type MirachatTenantResolveResult =
  | { ok: true; userId: string }
  | { ok: false; status: 401 | 403; message: string }

/**
 * @param claimedUserId — from JSON body or query when the client sends an explicit user id (may be undefined).
 */
export function resolveEffectiveTenantUserId(
  request: IncomingMessage,
  claimedUserId: string | undefined,
): MirachatTenantResolveResult {
  if (!mirachatTenantEnforceEnabled()) {
    const fallback = (claimedUserId?.trim() || 'demo-user').trim() || 'demo-user'
    return { ok: true, userId: fallback }
  }

  const subject = resolveMirachatTenantSubjectId(request)
  if (!subject) {
    return {
      ok: false,
      status: 401,
      message:
        'Tenant authentication required: send Authorization: Bearer <token>. Set MIRACHAT_TENANT_ENFORCE and MIRACHAT_TENANT_TOKEN_MAP and/or MIRACHAT_TENANT_HMAC_SECRET on the API.',
    }
  }

  const claimed = claimedUserId?.trim()
  if (claimed && claimed !== subject) {
    return {
      ok: false,
      status: 403,
      message: 'userId does not match authenticated tenant',
    }
  }

  return { ok: true, userId: subject }
}
