import { describe, expect, it } from 'vitest'
import {
  buildWindowSearchText,
  parseActiveWindowId,
  parseClientWindowIds,
  parseXpropWindowDetails,
  windowMatches,
  windowSummary,
} from '../scripts/x11-window-meta.mjs'

describe('x11 window metadata helpers', () => {
  it('parses the active window id from xprop root output', () => {
    expect(parseActiveWindowId('_NET_ACTIVE_WINDOW(WINDOW): window id # 0xb5cfb3')).toBe('0xb5cfb3')
    expect(parseActiveWindowId('_NET_ACTIVE_WINDOW(WINDOW): window id # 0x0')).toBeNull()
  })

  it('parses client window ids from xprop root output', () => {
    expect(parseClientWindowIds('_NET_CLIENT_LIST(WINDOW): window id # 0x2a00017, 0xb5cfb3')).toEqual([
      '0x2a00017',
      '0xb5cfb3',
    ])
  })

  it('parses WM_CLASS, names, and pid from xprop window output', () => {
    const meta = parseXpropWindowDetails(`
WM_CLASS(STRING) = "whatsapp-desktop", "WhatsApp-desktop"
WM_NAME(STRING) = "Family Chat"
_NET_WM_NAME(UTF8_STRING) = "Family Chat"
_NET_WM_PID(CARDINAL) = 1234
`)
    expect(meta).toEqual({
      wmClass: ['whatsapp-desktop', 'WhatsApp-desktop'],
      wmName: 'Family Chat',
      netWmName: 'Family Chat',
      pid: 1234,
    })
  })

  it('matches windows against combined metadata, not just title', () => {
    const meta = {
      id: '0x42',
      wmClass: ['whatsapp-desktop', 'WhatsApp-desktop'],
      wmName: null,
      netWmName: null,
      pid: 9001,
    }
    expect(buildWindowSearchText(meta)).toContain('whatsapp-desktop')
    expect(windowMatches(meta, /whatsapp/i)).toBe(true)
    expect(windowMatches(meta, /telegram/i)).toBe(false)
    expect(windowSummary(meta)).toContain('class=whatsapp-desktop/WhatsApp-desktop')
  })
})
