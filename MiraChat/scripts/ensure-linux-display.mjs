/**
 * If DISPLAY (and Wayland) are unset on Linux, pick an X11 socket owned by this uid
 * (e.g. /tmp/.X11-unix/X1 → DISPLAY=:1). Side-effect only; import before @nut-tree-fork/nut-js.
 */
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

if (
  process.platform === 'linux' &&
  !process.env.DISPLAY?.trim() &&
  !process.env.WAYLAND_DISPLAY?.trim()
) {
  try {
    const dir = '/tmp/.X11-unix'
    const uid = process.getuid()
    for (const name of readdirSync(dir)) {
      if (!name.startsWith('X')) continue
      const p = join(dir, name)
      const st = statSync(p)
      if (st.uid === uid) {
        process.env.DISPLAY = `:${name.slice(1)}`
        console.error(`[mirachat] DISPLAY was unset; using ${process.env.DISPLAY} (your X11 socket).`)
        break
      }
    }
  } catch {
    /* ignore */
  }
}
