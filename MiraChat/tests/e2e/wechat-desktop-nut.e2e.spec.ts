/**
 * Native WeChat **desktop** automation via [@nut-tree-fork/nut-js](https://www.npmjs.com/package/@nut-tree-fork/nut-js)
 * (community fork of nut.js — `@nut-tree/nut-js` is not published on npm as of 2026).
 *
 * **Opt-in only** (skipped unless `WECHAT_DESKTOP_E2E=1`). Never runs in default `npm test`.
 *
 * Prerequisites:
 * - Graphical session (Linux: `DISPLAY` set; X11/Wayland per libnut support).
 * - **CPU arch must match** prebuilt `libnut` (e.g. x86_64 Linux). On aarch64, native load may fail until a matching binary exists.
 * - WeChat desktop logged in; a chat thread open **or** use search flow below.
 *
 * Environment:
 * - `WECHAT_DESKTOP_E2E=1` — enable this file’s tests.
 * - `WECHAT_WINDOW_TITLE_REGEX` — optional, default matches `WeChat`, `微信`, `Weixin`.
 * - `WECHAT_DESKTOP_FULL=1` — run compose flow (focus → optional search → type message). Without this, only **load + list windows** runs.
 * - `WECHAT_DESKTOP_CONTACT` — if set (with FULL), after Ctrl+F types this name and presses Enter before the test message.
 * - `WECHAT_TEST_MESSAGE` — text to type into the composer (default: timestamped marker).
 * - `WECHAT_DESKTOP_COMMIT_SEND=1` — press Enter after the message (**actually sends**). Default: type only (no Enter).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import {
  focusWeChatWindow,
  openWeChatSearchShortcut,
  typeAndMaybeSend,
  type NutModule,
} from './lib/wechat-desktop-nut-actions.ts'

const enabled = process.env.WECHAT_DESKTOP_E2E === '1'
const fullFlow = process.env.WECHAT_DESKTOP_FULL === '1'

function titlePattern(): RegExp {
  const raw = process.env.WECHAT_WINDOW_TITLE_REGEX
  if (raw) {
    try {
      return new RegExp(raw, 'i')
    } catch {
      return /WeChat|微信|Weixin/i
    }
  }
  return /WeChat|微信|Weixin/i
}

describe.skipIf(!enabled)('E2E: WeChat desktop (nut.js)', () => {
  let nut: NutModule

  beforeAll(async () => {
    try {
      nut = await import('@nut-tree-fork/nut-js')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      throw new Error(
        `[WeChat desktop e2e] @nut-tree-fork/nut-js failed to load: ${msg}\n` +
          'Hints: on Linux arm64 run `npm install` (postinstall builds native libnut) or `node scripts/ensure-libnut-linux-native.mjs`; set DISPLAY for X11.',
      )
    }
  })

  it('loads native nut.js / libnut', () => {
    expect(nut.getWindows).toBeTypeOf('function')
    expect(nut.keyboard?.type).toBeTypeOf('function')
  })

  it('enumerates desktop windows', async () => {
    const wins = await nut.getWindows()
    expect(Array.isArray(wins)).toBe(true)
    expect(wins.length).toBeGreaterThanOrEqual(0)
  })

  it.skipIf(!fullFlow)('focuses WeChat, optional contact search, types test message', async () => {
    const contact = process.env.WECHAT_DESKTOP_CONTACT?.trim()
    const message =
      process.env.WECHAT_TEST_MESSAGE?.trim() ||
      `[MiraChat nut.js e2e ${new Date().toISOString()}]`
    const commitSend = process.env.WECHAT_DESKTOP_COMMIT_SEND === '1'

    await focusWeChatWindow(nut, titlePattern())

    if (contact) {
      await openWeChatSearchShortcut(nut)
      await typeAndMaybeSend(nut, contact, true)
      await nut.sleep(600)
    }

    await typeAndMaybeSend(nut, message, commitSend)
  })
})
