import twilio from 'twilio'
import type { TwilioGatewayConfig } from './config.js'
import { isTwilioRestLike } from './twilio-errors.js'

export type TwilioClient = ReturnType<typeof twilio>

export type AuthCandidate = {
  label: 'api_key' | 'auth_token'
  client: TwilioClient
}

export const createAuthCandidates = (config: TwilioGatewayConfig): AuthCandidate[] => {
  if (!config.accountSid) {
    return []
  }

  const clients: AuthCandidate[] = []
  if (config.apiKeySid && config.apiKeySecret) {
    clients.push({
      label: 'api_key',
      client: twilio(config.apiKeySid, config.apiKeySecret, { accountSid: config.accountSid }),
    })
  }
  if (config.authToken) {
    clients.push({
      label: 'auth_token',
      client: twilio(config.accountSid, config.authToken),
    })
  }
  return clients
}

export const shouldFallbackToAccountAuth = (
  candidates: AuthCandidate[],
  err: unknown,
  index: number,
): boolean =>
  index === 0 &&
  candidates.length > 1 &&
  candidates[0]?.label === 'api_key' &&
  candidates[1]?.label === 'auth_token' &&
  isTwilioRestLike(err) &&
  err.status === 401 &&
  err.code === 20003
