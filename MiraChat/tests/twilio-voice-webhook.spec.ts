import { createHmac } from 'node:crypto'
import { describe, it, expect } from 'vitest'
import { parseTwilioFormBody, validateTwilioPostSignature } from '../services/api/src/twilio-voice-webhook.js'

describe('twilio-voice-webhook', () => {
  it('parseTwilioFormBody decodes form', () => {
    expect(parseTwilioFormBody('CallSid=CA1&CallStatus=ringing')).toEqual({
      CallSid: 'CA1',
      CallStatus: 'ringing',
    })
  })

  it('validateTwilioPostSignature accepts Twilio-signed POST', () => {
    const authToken = '12345'
    const publicBase = 'https://mycompany.com'
    const pathnameWithQuery = '/myapp.php?foo=1&bar=2'
    const params = { CallSid: 'CA123', From: '+14155551234' }
    const data =
      `${publicBase}${pathnameWithQuery}CallSid${params.CallSid}From${params.From}`
    const signature = createHmac('sha1', authToken).update(data, 'utf8').digest('base64')
    expect(
      validateTwilioPostSignature(authToken, signature, publicBase, pathnameWithQuery, params),
    ).toBe(true)
    expect(validateTwilioPostSignature(authToken, 'wrong', publicBase, pathnameWithQuery, params)).toBe(
      false,
    )
  })
})
