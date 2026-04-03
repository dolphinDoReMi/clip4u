/**
 * Shared **wtype** sequence for WhatsApp Desktop (Wayland virtual keyboard).
 */
import { spawnSync } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

export function which(cmd) {
  const r = spawnSync('which', [cmd], { encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() : null
}

/**
 * @param {{ message: string, contact?: string, send?: boolean, focusWaitMs?: number }} args
 * @param {(s: string) => void} [log]
 */
export async function sendViaWtype(args, log = (s) => console.error(s)) {
  const w = which('wtype')
  if (!w) {
    throw new Error(
      'wtype not found. Install: sudo apt install wtype\n' +
        'Start the bridge from a terminal **inside your desktop session** (not raw SSH).',
    )
  }

  const run = (argv) => {
    const r = spawnSync('wtype', argv, { encoding: 'utf8', env: process.env })
    if (r.status !== 0) {
      throw new Error(`wtype ${argv.join(' ')} failed: ${r.stderr || r.stdout || 'exit ' + r.status}`)
    }
  }

  const ms = args.focusWaitMs ?? 8000
  log(`[wtype] Focus WhatsApp in ${ms}ms…`)
  await sleep(ms)

  const contact = String(args.contact ?? '').trim()
  if (contact) {
    log(`[wtype] Ctrl+K → ${contact}`)
    run(['-M', 'ctrl', '-k', 'k'])
    await sleep(500)
    run([contact])
    await sleep(250)
    run(['-k', 'Return'])
    await sleep(900)
  }

  log(`[wtype] Typing (${args.send !== false ? 'send Enter' : 'no send'})`)
  run([args.message])
  await sleep(120)
  if (args.send !== false) run(['-k', 'Return'])
  log('[wtype] Done.')
}
