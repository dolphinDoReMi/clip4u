#!/usr/bin/env node
import './ensure-linux-display.mjs'
/**
 * Reply in **WhatsApp Desktop** (or a window whose title matches) using nut.js.
 * Run on **your** machine with WhatsApp open. Not wired to MiraChat APIs.
 *
 * From **MiraChat**: `cd MiraChat` so `node_modules` resolves.
 *
 * Default chat search: **Ctrl+K** (Linux/Windows) or **Cmd+K** (macOS), then type
 * contact name and Enter — common for WhatsApp Desktop; your build may differ.
 *
 * Usage:
 *   npm run whatsapp:reply -- --message "On my way"
 *   npm run whatsapp:reply -- -m "Hi" -c "Team group"
 *   npm run whatsapp:reply -- -m "draft" --no-send
 *
 * **Wayland / empty window title:** if nut.js cannot find "WhatsApp" in the title, use
 *   `--no-focus` — click WhatsApp so it is focused, then the script waits (default 5s) and sends keys to the active window.
 *
 * Env:
 *   WHATSAPP_WINDOW_TITLE_REGEX   default matches WhatsApp (see below)
 *   WHATSAPP_SEARCH_MODE          ctrl-k | cmd-k | ctrl-f | ctrl-shift-f
 *                                 (default: ctrl-k on linux/win, cmd-k on darwin)
 *
 * Requires: DISPLAY / GUI, @nut-tree-fork/nut-js + libnut (see README).
 */
function parseArgs(argv) {
  const out = {
    message: '',
    contact: '',
    send: true,
    pauseMs: 400,
    help: false,
    noFocus: false,
    focusWaitMs: 5000,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--message' || a === '-m') out.message = String(argv[++i] ?? '')
    else if (a === '--contact' || a === '-c') out.contact = String(argv[++i] ?? '')
    else if (a === '--no-send') out.send = false
    else if (a === '--no-focus') out.noFocus = true
    else if (a === '--focus-wait-ms') out.focusWaitMs = Number(argv[++i] ?? '5000') || 5000
    else if (a === '--pause-ms') out.pauseMs = Number(argv[++i] ?? '400') || 400
    else if (a === '--help' || a === '-h') out.help = true
    else if (!a.startsWith('-') && !out.message) out.message = a
  }
  return out
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
  if (env === 'ctrl-k' || env === 'cmd-k' || env === 'ctrl-f' || env === 'ctrl-shift-f')
    return env
  return process.platform === 'darwin' ? 'cmd-k' : 'ctrl-k'
}

async function findWindowByTitlePattern(nut, pattern) {
  const wins = await nut.getWindows()
  for (const w of wins) {
    if (pattern.test(await w.title)) return w
  }
  return null
}

async function focusWhatsAppWindow(nut, pattern) {
  const w = await findWindowByTitlePattern(nut, pattern)
  if (!w) {
    throw new Error(
      `No window matched ${pattern}. Open WhatsApp, then either set WHATSAPP_WINDOW_TITLE_REGEX, or use --no-focus (click WhatsApp first; Wayland often hides titles from X11).`,
    )
  }
  await w.focus()
  await nut.sleep(350)
  return w
}

/**
 * Open chat list search (WhatsApp Desktop often binds Ctrl+K / Cmd+K).
 */
async function openWhatsAppChatSearch(nut, mode) {
  const { keyboard, Key, sleep } = nut
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
    case 'ctrl-k':
    default:
      await keyboard.pressKey(Key.LeftControl, Key.K)
      await keyboard.releaseKey(Key.LeftControl, Key.K)
      break
  }
  await sleep(450)
}

async function typeAndMaybeSend(nut, text, commitSend) {
  const { keyboard, Key, sleep } = nut
  await keyboard.type(text)
  await sleep(150)
  if (commitSend) await keyboard.type(Key.Enter)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(`Usage: node scripts/whatsapp-reply-nut.mjs --message "text" [--contact "chat name"] [--no-send]

  -m, --message   Reply body (required)
  -c, --contact   Optional: chat search shortcut, type name, Enter — then message
      --no-send   Type only; do not press Enter to send
      --no-focus  Do not search window title — wait then send keys (Wayland / empty title)
      --focus-wait-ms  Ms to wait after --no-focus (default 5000)
      --pause-ms  Delay after focus (default 400)

Env:
  WHATSAPP_WINDOW_TITLE_REGEX   window title regex (default: WhatsApp)
  WHATSAPP_SEARCH_MODE           ctrl-k | cmd-k | ctrl-f | ctrl-shift-f`)
    process.exit(0)
  }
  if (!args.message.trim()) {
    console.error('Error: pass --message "..."')
    process.exit(1)
  }

  let nut
  try {
    nut = await import('@nut-tree-fork/nut-js')
  } catch (e) {
    console.error(
      'Failed to load @nut-tree-fork/nut-js. Run `npm install` in MiraChat/.',
      e instanceof Error ? e.message : e,
    )
    process.exit(1)
  }

  const pattern = titlePattern()
  const mode = searchMode()
  if (args.noFocus) {
    const ms = args.focusWaitMs
    console.error(
      `[whatsapp-reply-nut] --no-focus: click WhatsApp so it is active; sending keys in ${ms}ms…`,
    )
    await nut.sleep(ms)
  } else {
    console.error(`[whatsapp-reply-nut] Focusing window (${pattern}), search mode: ${mode}…`)
    await focusWhatsAppWindow(nut, pattern)
    await nut.sleep(args.pauseMs)
  }

  if (args.contact.trim()) {
    console.error(`[whatsapp-reply-nut] Search chat: ${args.contact}`)
    await openWhatsAppChatSearch(nut, mode)
    await typeAndMaybeSend(nut, args.contact.trim(), true)
    await nut.sleep(600)
  }

  console.error(
    `[whatsapp-reply-nut] Typing message (${args.send ? 'will send Enter' : 'no send'})…`,
  )
  await typeAndMaybeSend(nut, args.message, args.send)
  console.error('[whatsapp-reply-nut] Done.')
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
