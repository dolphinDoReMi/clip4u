/**
 * Drive **keyboard only** (no window search) via nut.js — keys go to the **focused** window.
 * Works on **X11** when WhatsApp has no discoverable title (e.g. Electron quirks).
 */
import './ensure-linux-display.mjs'
import { setTimeout as sleep } from 'node:timers/promises'
import { getActiveX11Window, windowMatches, windowSummary } from './x11-window-meta.mjs'

function focusedWindowPattern(raw) {
  const source = String(raw || process.env.WHATSAPP_FOCUSED_WINDOW_REGEX || 'whatsapp').trim()
  try {
    return new RegExp(source, 'i')
  } catch {
    return /whatsapp/i
  }
}

export async function sendViaNutToFocusedWindow(args, log = (s) => console.error(s)) {
  let nut
  try {
    nut = await import('@nut-tree-fork/nut-js')
  } catch (e) {
    throw new Error('nut.js failed to load: ' + (e instanceof Error ? e.message : String(e)))
  }
  const { keyboard, Key } = nut
  const ms = args.focusWaitMs ?? 8000
  const pattern = focusedWindowPattern(args.focusedWindowRegex)
  const pollMs = Math.min(500, Math.max(200, Math.floor(ms / 10) || 200))
  const initial = getActiveX11Window()
  log(`[nut-focus] Current active window: ${windowSummary(initial)}`)
  log(`[nut-focus] Waiting up to ${ms}ms for focused window to match ${pattern}…`)

  const deadline = Date.now() + ms
  let target = initial
  while (Date.now() < deadline) {
    target = getActiveX11Window()
    if (windowMatches(target, pattern)) break
    await sleep(pollMs)
  }
  if (!windowMatches(target, pattern)) {
    throw new Error(
      `[nut-focus] Focus guard failed. Active window was ${windowSummary(target)}; expected ${pattern}. ` +
        `Focus WhatsApp, or override WHATSAPP_FOCUSED_WINDOW_REGEX if its class/title differs.`,
    )
  }
  log(`[nut-focus] Focus guard matched: ${windowSummary(target)}`)

  const contact = String(args.contact ?? '').trim()
  if (contact) {
    log(`[nut-focus] Ctrl+K → ${contact}`)
    await keyboard.pressKey(Key.LeftControl, Key.K)
    await keyboard.releaseKey(Key.LeftControl, Key.K)
    await nut.sleep(500)
    await keyboard.type(contact)
    await nut.sleep(200)
    await keyboard.type(Key.Enter)
    await nut.sleep(900)
  }

  log(`[nut-focus] Typing (${args.send !== false ? 'send' : 'no send'})`)
  await keyboard.type(args.message)
  await nut.sleep(120)
  if (args.send !== false) await keyboard.type(Key.Enter)
  log('[nut-focus] Done.')
}
