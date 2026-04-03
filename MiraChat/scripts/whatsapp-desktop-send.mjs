#!/usr/bin/env node
/**
 * Send a WhatsApp message from the **desktop app** (not WhatsApp Web).
 *
 * **Wayland (recommended):** uses **wtype** — types into whatever window is focused.
 *   Install: `sudo apt install wtype`
 *   You get a countdown to **click WhatsApp** and optionally open the right chat first.
 *
 * **X11:** uses **nut.js** to find a window whose title matches `WhatsApp` and drive Ctrl+K search.
 *
 * Usage (from MiraChat/):
 *   npm run whatsapp:reply -- --contact "tennis group" --message "I am ok"
 *   npm run whatsapp:reply -- -m "Hi" --backend wtype --focus-wait-ms 8000
 *
 * Env:
 *   WHATSAPP_INPUT_BACKEND   wtype | nut | auto (default: auto)
 *   WHATSAPP_WINDOW_TITLE_REGEX  for nut.js only
 *   WHATSAPP_SEARCH_MODE     ctrl-k | cmd-k | ctrl-f (nut path)
 */
import './ensure-linux-display.mjs'
import { spawnSync } from 'node:child_process'
import { which, sendViaWtype } from './whatsapp-wtype-core.mjs'

function parseArgs(argv) {
  const out = {
    message: '',
    contact: '',
    send: true,
    pauseMs: 400,
    focusWaitMs: 8000,
    help: false,
    backend: (process.env.WHATSAPP_INPUT_BACKEND || 'auto').toLowerCase(),
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--message' || a === '-m') out.message = String(argv[++i] ?? '')
    else if (a === '--contact' || a === '-c') out.contact = String(argv[++i] ?? '')
    else if (a === '--no-send') out.send = false
    else if (a === '--pause-ms') out.pauseMs = Number(argv[++i] ?? '400') || 400
    else if (a === '--focus-wait-ms') out.focusWaitMs = Number(argv[++i] ?? '8000') || 8000
    else if (a === '--backend') out.backend = String(argv[++i] ?? 'auto').toLowerCase()
    else if (a === '--help' || a === '-h') out.help = true
    else if (!a.startsWith('-') && !out.message) out.message = a
  }
  return out
}

function isWayland() {
  return Boolean(process.env.WAYLAND_DISPLAY) || process.env.XDG_SESSION_TYPE === 'wayland'
}

async function runWtypeCli(args) {
  await sendViaWtype(
    {
      message: args.message,
      contact: args.contact,
      send: args.send,
      focusWaitMs: args.focusWaitMs,
    },
    (line) => console.error(line.replace('[wtype]', '[whatsapp-desktop]')),
  )
}

function titlePattern() {
  const raw = process.env.WHATSAPP_WINDOW_TITLE_REGEX
  if (!raw) return /WhatsApp/i
  try {
    return new RegExp(raw, 'i')
  } catch {
    return /WhatsApp/i
  }
}

function searchMode() {
  const env = process.env.WHATSAPP_SEARCH_MODE?.trim().toLowerCase()
  if (['ctrl-k', 'cmd-k', 'ctrl-f', 'ctrl-shift-f'].includes(env)) return env
  return process.platform === 'darwin' ? 'cmd-k' : 'ctrl-k'
}

async function findWindowByTitlePattern(nut, pattern) {
  const wins = await nut.getWindows()
  for (const w of wins) {
    if (pattern.test(await w.title)) return w
  }
  return null
}

async function openWhatsAppChatSearch(nut, mode) {
  const { keyboard, Key, sleep: sn } = nut
  switch (mode) {
    case 'cmd-k':
      await keyboard.pressKey(Key.LeftSuper, Key.K)
      await keyboard.releaseKey(Key.LeftSuper, Key.K)
      break
    case 'ctrl-f':
      await keyboard.pressKey(Key.LeftControl, Key.F)
      await keyboard.releaseKey(Key.LeftControl, Key.F)
      break
    case 'ctrl-shift-f':
      await keyboard.pressKey(Key.LeftControl, Key.LeftShift, Key.F)
      await keyboard.releaseKey(Key.LeftControl, Key.LeftShift, Key.F)
      break
    default:
      await keyboard.pressKey(Key.LeftControl, Key.K)
      await keyboard.releaseKey(Key.LeftControl, Key.K)
      break
  }
  await sn(450)
}

async function typeAndMaybeSend(nut, text, commitSend) {
  const { keyboard, Key, sleep: sn } = nut
  await keyboard.type(text)
  await sn(150)
  if (commitSend) await keyboard.type(Key.Enter)
}

async function sendViaNut(args) {
  let nut
  try {
    nut = await import('@nut-tree-fork/nut-js')
  } catch (e) {
    throw new Error(
      'nut.js failed to load. Run npm install in MiraChat/. ' + (e instanceof Error ? e.message : ''),
    )
  }

  const pattern = titlePattern()
  const mode = searchMode()
  console.error(`[whatsapp-desktop] nut.js: focus ${pattern}, search ${mode}…`)

  const w = await findWindowByTitlePattern(nut, pattern)
  if (!w) {
    throw new Error(
      `No window matched ${pattern}. On Wayland use wtype: install wtype, run with --backend wtype, ` +
        `or set WHATSAPP_WINDOW_TITLE_REGEX if the title differs.`,
    )
  }
  await w.focus()
  await nut.sleep(args.pauseMs)

  if (args.contact.trim()) {
    await openWhatsAppChatSearch(nut, mode)
    await typeAndMaybeSend(nut, args.contact.trim(), true)
    await nut.sleep(600)
  }

  await typeAndMaybeSend(nut, args.message, args.send)
  console.error('[whatsapp-desktop] Done (nut.js).')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(`Usage: node scripts/whatsapp-desktop-send.mjs -m "text" [-c "chat"] [--backend wtype|nut|auto]

  --backend wtype   Wayland: use wtype (focus WhatsApp during countdown)
  --backend nut     X11: focus window by title + nut.js
  --backend auto    Wayland + wtype installed → wtype; else nut
  --focus-wait-ms   Wait before keys (wtype only, default 8000)
  --no-send         Type only, no Enter to send`)
    process.exit(0)
  }
  if (!args.message.trim()) {
    console.error('Error: pass --message "..."')
    process.exit(1)
  }

  let backend = args.backend
  if (backend === 'auto') {
    if (isWayland()) {
      if (which('wtype')) backend = 'wtype'
      else {
        console.error(
          '[whatsapp-desktop] Wayland: no wtype — install: sudo apt install wtype (recommended). Trying nut.js (often cannot see WhatsApp)…',
        )
        backend = 'nut'
      }
    } else backend = 'nut'
  }

  if (backend === 'wtype') {
    await runWtypeCli(args)
    return
  }
  if (backend === 'nut') {
    await sendViaNut(args)
    return
  }
  throw new Error(`Unknown --backend ${backend} (use wtype, nut, auto)`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
