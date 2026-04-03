#!/usr/bin/env node
import './ensure-linux-display.mjs'
/**
 * Reply in the **WeChat desktop** client using nut.js (@nut-tree-fork/nut-js).
 *
 * You run this on **your** machine (with WeChat open). It does not go through MiraChat APIs.
 * Run from the **MiraChat** directory (`cd MiraChat`) so `node_modules` resolves.
 *
 * Usage:
 *   npm run wechat:reply -- --message "Thanks, on it"
 *   node scripts/wechat-reply-nut.mjs --message "Thanks, on it"
 *   node scripts/wechat-reply-nut.mjs -m "OK" -c "Alice"     # Ctrl/Cmd+F, search contact, Enter, then message
 *   node scripts/wechat-reply-nut.mjs -m "draft only" --no-send
 *
 * Env:
 *   WECHAT_WINDOW_TITLE_REGEX  optional title regex (default: WeChat|微信|Weixin)
 *
 * Requires: graphical session (DISPLAY on Linux), native libnut (see README / postinstall).
 */
function parseArgs(argv) {
  const out = {
    message: '',
    contact: '',
    send: true,
    pauseMs: 400,
    help: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--message' || a === '-m') out.message = String(argv[++i] ?? '')
    else if (a === '--contact' || a === '-c') out.contact = String(argv[++i] ?? '')
    else if (a === '--no-send') out.send = false
    else if (a === '--pause-ms') out.pauseMs = Number(argv[++i] ?? '400') || 400
    else if (a === '--help' || a === '-h') {
      out.help = true
    }
    else if (!a.startsWith('-') && !out.message) out.message = a
  }
  return out
}

function titlePattern() {
  const raw = process.env.WECHAT_WINDOW_TITLE_REGEX
  if (!raw) return /WeChat|微信|Weixin/i
  try {
    return new RegExp(raw, 'i')
  } catch {
    return /WeChat|微信|Weixin/i
  }
}

async function findWindowByTitlePattern(nut, pattern) {
  const wins = await nut.getWindows()
  for (const w of wins) {
    if (pattern.test(await w.title)) return w
  }
  return null
}

async function focusWeChatWindow(nut, pattern) {
  const w = await findWindowByTitlePattern(nut, pattern)
  if (!w) {
    throw new Error(
      `No window matched ${pattern}. Open WeChat and set WECHAT_WINDOW_TITLE_REGEX if the title differs.`,
    )
  }
  await w.focus()
  await nut.sleep(350)
  return w
}

async function openWeChatSearch(nut) {
  const { keyboard, Key, sleep } = nut
  if (process.platform === 'darwin') {
    await keyboard.pressKey(Key.LeftSuper, Key.F)
    await keyboard.releaseKey(Key.LeftSuper, Key.F)
  } else {
    await keyboard.pressKey(Key.LeftControl, Key.F)
    await keyboard.releaseKey(Key.LeftControl, Key.F)
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
    console.log(`Usage: node scripts/wechat-reply-nut.mjs --message "text" [--contact "name"] [--no-send]

  -m, --message   Reply body (required)
  -c, --contact   Optional: open search (Ctrl/Cmd+F), type name, Enter — then message
      --no-send   Type only; do not press Enter to send
      --pause-ms  Delay after focus (default 400)

Env: WECHAT_WINDOW_TITLE_REGEX`)
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
  console.error(`[wechat-reply-nut] Focusing WeChat (${pattern})…`)
  await focusWeChatWindow(nut, pattern)
  await nut.sleep(args.pauseMs)

  if (args.contact.trim()) {
    console.error(`[wechat-reply-nut] Search contact: ${args.contact}`)
    await openWeChatSearch(nut)
    await typeAndMaybeSend(nut, args.contact.trim(), true)
    await nut.sleep(600)
  }

  console.error(
    `[wechat-reply-nut] Typing message (${args.send ? 'will send Enter' : 'no send'})…`,
  )
  await typeAndMaybeSend(nut, args.message, args.send)
  console.error('[wechat-reply-nut] Done.')
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
