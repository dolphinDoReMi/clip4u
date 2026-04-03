#!/usr/bin/env node
/**
 * Issue a short-lived HMAC tenant token for MiraChat API when MIRACHAT_TENANT_HMAC_SECRET is set.
 *
 * Usage:
 *   MIRACHAT_TENANT_HMAC_SECRET=your-secret node scripts/mirachat-issue-tenant-token.mjs demo-user 86400
 *
 * Prints one line: the bearer string to pass as Authorization: Bearer <line>
 */
import { createHmac } from 'node:crypto'

const secret = process.env.MIRACHAT_TENANT_HMAC_SECRET?.trim()
if (!secret) {
  console.error('Set MIRACHAT_TENANT_HMAC_SECRET in the environment.')
  process.exit(1)
}

const sub = process.argv[2]?.trim()
const ttlSec = Math.max(60, Number(process.argv[3] ?? 86_400) || 86_400)
if (!sub) {
  console.error('Usage: MIRACHAT_TENANT_HMAC_SECRET=... node scripts/mirachat-issue-tenant-token.mjs <userId> [ttlSeconds]')
  process.exit(1)
}

const exp = Math.floor(Date.now() / 1000) + ttlSec
const payload = Buffer.from(JSON.stringify({ sub, exp }), 'utf8').toString('base64url')
const sig = createHmac('sha256', secret).update(payload).digest('base64url')
console.log(`${payload}.${sig}`)
