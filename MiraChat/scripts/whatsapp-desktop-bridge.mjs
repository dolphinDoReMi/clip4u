#!/usr/bin/env node
/**
 * Run in a **desktop terminal** (inherits DISPLAY / Wayland). Agent sends:
 *
 *   curl -sS -X POST http://127.0.0.1:9742/send \
 *     -H 'Content-Type: application/json' \
 *     -d '{"contact":"tennis group","message":"I am ok","focusWaitMs":8000}'
 *
 * Backends (auto unless JSON `backend` or env `WHATSAPP_BRIDGE_BACKEND`):
 *   wtype      — Wayland virtual keyboard (needs `wtype`)
 *   nut-focus  — nut.js keys to **focused** window (X11; use when WhatsApp has no title match)
 *
 * X11 `nut-focus` now verifies the currently focused window looks like WhatsApp before typing.
 * Override the matcher with JSON `focusedWindowRegex` or env `WHATSAPP_FOCUSED_WINDOW_REGEX`.
 *
 * Env: MIRACHAT_WHATSAPP_BRIDGE_PORT (9742), MIRACHAT_WHATSAPP_BRIDGE_TOKEN, DISPLAY
 */
import './ensure-linux-display.mjs'
import http from 'node:http'
import { sendViaWtype, which } from './whatsapp-wtype-core.mjs'
import { sendViaNutToFocusedWindow } from './whatsapp-unfocused-input.mjs'
import { getActiveX11Window } from './x11-window-meta.mjs'

const PORT = Number(process.env.MIRACHAT_WHATSAPP_BRIDGE_PORT ?? '9742') || 9742
const TOKEN = (process.env.MIRACHAT_WHATSAPP_BRIDGE_TOKEN ?? '').trim()

function pickBackend(explicit) {
  const e = (explicit || process.env.WHATSAPP_BRIDGE_BACKEND || '').trim().toLowerCase()
  if (e === 'wtype' || e === 'nut-focus') return e
  if (e === 'auto' || !e) {
    const wl = Boolean(process.env.WAYLAND_DISPLAY)
    if (wl && which('wtype')) return 'wtype'
    if (process.env.DISPLAY) return 'nut-focus'
    if (which('wtype')) return 'wtype'
    return 'nut-focus'
  }
  return e
}

const server = http.createServer(async (req, res) => {
  const send = (code, body, json = false) => {
    res.writeHead(code, json ? { 'Content-Type': 'application/json' } : {})
    res.end(body)
  }

  if (req.method === 'GET' && (req.url === '/health' || req.url === '/')) {
    return send(
      200,
      JSON.stringify({
        ok: true,
        display: process.env.DISPLAY || null,
        wayland: process.env.WAYLAND_DISPLAY || null,
        session: process.env.XDG_SESSION_TYPE || null,
        hasWtype: Boolean(which('wtype')),
        defaultBackend: pickBackend('auto'),
        activeWindow: getActiveX11Window(),
      }),
      true,
    )
  }

  if (req.method !== 'POST' || req.url !== '/send') {
    return send(404, 'not found')
  }

  if (TOKEN && req.headers['x-mirachat-token'] !== TOKEN) {
    return send(401, 'unauthorized')
  }

  let raw = ''
  for await (const chunk of req) raw += chunk

  let body
  try {
    body = JSON.parse(raw || '{}')
  } catch {
    return send(400, 'invalid json')
  }

  const message = String(body.message ?? '').trim()
  if (!message) return send(400, 'need message')

  const contact = String(body.contact ?? '').trim()
  const sendMsg = body.send !== false
  const focusWaitMs = Number(body.focusWaitMs ?? 8000) || 8000
  const backend = pickBackend(body.backend)
  const focusedWindowRegex = String(body.focusedWindowRegex ?? '').trim()

  const log = (line) => console.error(`[bridge] ${line}`)

  try {
    if (backend === 'wtype') {
      await sendViaWtype({ message, contact, send: sendMsg, focusWaitMs }, log)
    } else if (backend === 'nut-focus') {
      await sendViaNutToFocusedWindow(
        { message, contact, send: sendMsg, focusWaitMs, focusedWindowRegex },
        log,
      )
    } else {
      return send(400, JSON.stringify({ ok: false, error: `unknown backend ${backend}` }), true)
    }
    return send(200, JSON.stringify({ ok: true, backend }), true)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[bridge] error', msg)
    return send(500, JSON.stringify({ ok: false, error: msg }), true)
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.error(
    `[whatsapp-bridge] http://127.0.0.1:${PORT}/send  DISPLAY=${process.env.DISPLAY || '(none)'} defaultBackend=${pickBackend('auto')}`,
  )
})
