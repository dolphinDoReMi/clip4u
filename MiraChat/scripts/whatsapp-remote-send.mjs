#!/usr/bin/env node
/**
 * POST to the **desktop bridge** (see whatsapp-desktop-bridge.mjs). Use from Cursor when
 * the bridge runs in a **desktop terminal** with the real GUI session.
 *
 *   npm run whatsapp:remote -- --contact "tennis group" --message "I am ok"
 *
 * X11 `nut-focus` can require the active window to match a custom regex:
 *   npm run whatsapp:remote -- -m "I am ok" --focused-window-regex 'whatsapp|electron'
 *
 * Env: MIRACHAT_WHATSAPP_BRIDGE_URL (default http://127.0.0.1:9742), MIRACHAT_WHATSAPP_BRIDGE_TOKEN
 */
function parseArgs(argv) {
  const out = { contact: '', message: '', focusWaitMs: 8000, focusedWindowRegex: '' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--contact' || a === '-c') out.contact = String(argv[++i] ?? '')
    else if (a === '--message' || a === '-m') out.message = String(argv[++i] ?? '')
    else if (a === '--focus-wait-ms') out.focusWaitMs = Number(argv[++i] ?? '8000') || 8000
    else if (a === '--focused-window-regex') out.focusedWindowRegex = String(argv[++i] ?? '')
  }
  return out
}

const base = (process.env.MIRACHAT_WHATSAPP_BRIDGE_URL ?? 'http://127.0.0.1:9742').replace(/\/$/, '')
const token = process.env.MIRACHAT_WHATSAPP_BRIDGE_TOKEN ?? ''

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.message.trim()) {
    console.error(
      'Usage: node scripts/whatsapp-remote-send.mjs -m "text" [-c "chat"] [--focus-wait-ms 8000] [--focused-window-regex "whatsapp|electron"]',
    )
    process.exit(1)
  }

  const headers = { 'Content-Type': 'application/json' }
  if (token) headers['X-MiraChat-Token'] = token

  const res = await fetch(`${base}/send`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      contact: args.contact,
      message: args.message,
      focusWaitMs: args.focusWaitMs,
      focusedWindowRegex: args.focusedWindowRegex,
    }),
  })
  const text = await res.text()
  console.log(res.status, text)
  if (!res.ok) process.exit(1)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
