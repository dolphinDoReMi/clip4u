import { createHmac, timingSafeEqual } from 'node:crypto'

/** Parse application/x-www-form-urlencoded body to a flat string map (last duplicate key wins). */
export const parseTwilioFormBody = (raw: string): Record<string, string> => {
  const out: Record<string, string> = {}
  const p = new URLSearchParams(raw)
  for (const [k, v] of p) {
    out[k] = v
  }
  return out
}

/**
 * Validate Twilio webhook signature (POST). See https://www.twilio.com/docs/usage/webhooks/webhooks-security
 *
 * @param publicUrlBase — Public origin only, e.g. https://your-ngrok.app (no trailing path)
 * @param pathnameWithQuery — Request path + query as Twilio called it, e.g. /mirachat/webhooks/twilio/voice-call-status?foo=1
 */
export const validateTwilioPostSignature = (
  authToken: string,
  signatureHeader: string | undefined,
  publicUrlBase: string,
  pathnameWithQuery: string,
  formParams: Record<string, string>,
): boolean => {
  if (!signatureHeader) {
    return false
  }
  const base = publicUrlBase.replace(/\/$/, '')
  const path = pathnameWithQuery.startsWith('/') ? pathnameWithQuery : `/${pathnameWithQuery}`
  const fullUrl = `${base}${path}`
  const sortedKeys = Object.keys(formParams).sort()
  let payload = fullUrl
  for (const k of sortedKeys) {
    payload += k + formParams[k]
  }
  const mac = createHmac('sha1', authToken).update(payload, 'utf8').digest('base64')
  try {
    return timingSafeEqual(Buffer.from(mac), Buffer.from(signatureHeader))
  } catch {
    return false
  }
}
