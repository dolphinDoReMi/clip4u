import { describe, expect, it } from 'vitest'
import {
  MIRACHAT_INGEST_SUGGESTED_REPLY_MARKER,
  buildIngestSuggestedReplyMemoryChunk,
  extractLatestIngestSuggestedReply,
} from '@delegate-ai/agent-core'

describe('ingest suggested reply memory chunk', () => {
  it('buildIngestSuggestedReplyMemoryChunk returns empty for blank reply', () => {
    expect(buildIngestSuggestedReplyMemoryChunk({ channel: 'whatsapp', threadId: 't1', reply: '  ' })).toBe('')
  })

  it('round-trips through extractLatestIngestSuggestedReply', () => {
    const chunk = buildIngestSuggestedReplyMemoryChunk({
      channel: 'twilio_whatsapp',
      threadId: 'whatsapp:+1',
      reply: 'We had 4 calls in the last 7 days — all show as busy.',
    })
    expect(chunk.startsWith(MIRACHAT_INGEST_SUGGESTED_REPLY_MARKER)).toBe(true)
    const got = extractLatestIngestSuggestedReply([
      {
        channel: 'memory',
        content: chunk,
      },
    ])
    expect(got).toBe('We had 4 calls in the last 7 days — all show as busy.')
  })

  it('extractLatestIngestSuggestedReply picks the latest memory row', () => {
    const a = buildIngestSuggestedReplyMemoryChunk({
      channel: 'whatsapp',
      threadId: 't1',
      reply: 'First draft.',
    })
    const b = buildIngestSuggestedReplyMemoryChunk({
      channel: 'whatsapp',
      threadId: 't1',
      reply: 'Second draft.',
    })
    expect(extractLatestIngestSuggestedReply([{ channel: 'memory', content: a }])).toBe('First draft.')
    expect(
      extractLatestIngestSuggestedReply([
        { channel: 'memory', content: a },
        { channel: 'memory', content: b },
      ]),
    ).toBe('Second draft.')
  })

  it('preserves multiline suggested replies', () => {
    const chunk = buildIngestSuggestedReplyMemoryChunk({
      channel: 'whatsapp',
      threadId: 't1',
      reply: 'Line one.\n\nLine two.',
    })
    expect(extractLatestIngestSuggestedReply([{ channel: 'memory', content: chunk }])).toBe('Line one.\n\nLine two.')
  })
})
