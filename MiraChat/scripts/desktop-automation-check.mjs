#!/usr/bin/env node
import './ensure-linux-display.mjs'
import { getActiveX11Window, listX11ClientWindows, windowSummary } from './x11-window-meta.mjs'
/**
 * Check whether this terminal can drive nut.js (GUI session).
 *
 *   npm run desktop:check
 *
 * If DISPLAY is empty, desktop reply scripts cannot control apps. Typical fixes on Linux:
 *   export DISPLAY=:0
 *   # or :1 — run `echo $DISPLAY` in a terminal *inside* your desktop session and match it.
 *
 * Remote SSH: enable X11 forwarding or run the script only on the machine’s local graphical terminal.
 */
const d = process.env.DISPLAY
const w = process.env.WAYLAND_DISPLAY
console.log('DISPLAY=', d || '(unset)')
console.log('WAYLAND_DISPLAY=', w || '(unset)')
console.log('platform=', process.platform, 'arch=', process.arch)

if (process.platform === 'linux' && !d && !w) {
  console.log('\nNo display env — nut.js cannot attach to X11/Wayland.')
  console.log('Try: DISPLAY=:0 npm run desktop:check')
  process.exitCode = 1
}

try {
  const nut = await import('@nut-tree-fork/nut-js')
  const wins = await nut.getWindows()
  console.log('nut.js getWindows count:', wins.length)
  if (wins.length > 0) {
    for (let i = 0; i < Math.min(5, wins.length); i++) {
      console.log(' ', await wins[i].title)
    }
  }
} catch (e) {
  console.error('nut.js load/runtime error:', e instanceof Error ? e.message : e)
  process.exitCode = 1
}

if (process.platform === 'linux' && process.env.DISPLAY?.trim()) {
  const active = getActiveX11Window()
  console.log('x11 active window:', windowSummary(active))
  const clients = listX11ClientWindows(10)
  if (clients.length > 0) {
    console.log('x11 client windows:')
    for (const client of clients) console.log(' ', windowSummary(client))
  }
}
