#!/usr/bin/env node
import './ensure-linux-display.mjs'

import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { getActiveX11Window, windowMatches, windowSummary } from './x11-window-meta.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function usage() {
  console.log(`Usage:
  node scripts/capture-chat-context.mjs --channel whatsapp --user-id demo-user --thread-id alice \\
    --summary "Alice asked about Tuesday timing" \\
    --relationship-note "Prefers quick WhatsApp confirmations" \\
    --identity-hint "Use concise acknowledgement in WhatsApp chats"

Options:
  --channel              whatsapp | wechat (required)
  --user-id              Mira user id (required)
  --thread-id            Thread id / chat id (required)
  --contact-id           Contact id (defaults to thread id)
  --summary              Human summary of the screenshot context
  --text                 Extracted text / pasted transcript from screenshot
  --relationship-note    Repeatable; merges into relationship notes
  --identity-hint        Repeatable; merges into identity style guide
  --api-base             API base (default: http://127.0.0.1:4000)
  --out                  Screenshot output path
  --capture-tool         Override capture tool label (default: scrot)
  --no-window-check      Skip active-window title/class validation
  --open-router-analysis Force OpenRouter analysis on
  --no-open-router       Force OpenRouter analysis off
                         (default: on when OPENROUTER_API_KEY is set in the environment)
`)
}

function parseArgs(argv) {
  const out = {
    channel: '',
    userId: '',
    threadId: '',
    contactId: '',
    summary: '',
    extractedText: '',
    identityHints: [],
    relationshipNotes: [],
    apiBase: process.env.MIRACHAT_API_BASE || 'http://127.0.0.1:4000',
    out: '',
    captureTool: 'scrot',
    noWindowCheck: false,
    /** null = default from OPENROUTER_API_KEY env */
    openRouterMode: null,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--channel') out.channel = String(argv[++i] ?? '')
    else if (a === '--user-id') out.userId = String(argv[++i] ?? '')
    else if (a === '--thread-id') out.threadId = String(argv[++i] ?? '')
    else if (a === '--contact-id') out.contactId = String(argv[++i] ?? '')
    else if (a === '--summary') out.summary = String(argv[++i] ?? '')
    else if (a === '--text') out.extractedText = String(argv[++i] ?? '')
    else if (a === '--identity-hint') out.identityHints.push(String(argv[++i] ?? ''))
    else if (a === '--relationship-note') out.relationshipNotes.push(String(argv[++i] ?? ''))
    else if (a === '--api-base') out.apiBase = String(argv[++i] ?? out.apiBase)
    else if (a === '--out') out.out = String(argv[++i] ?? '')
    else if (a === '--capture-tool') out.captureTool = String(argv[++i] ?? out.captureTool)
    else if (a === '--no-window-check') out.noWindowCheck = true
    else if (a === '--open-router-analysis') out.openRouterMode = 'on'
    else if (a === '--no-open-router') out.openRouterMode = 'off'
    else if (a === '--help' || a === '-h') out.help = true
  }
  return out
}

function expectedWindowRegex(channel) {
  if (channel === 'wechat') return /WeChat|微信|Weixin/i
  if (channel === 'whatsapp') return /WhatsApp/i
  return null
}

function trimList(items) {
  return items.map(item => item.trim()).filter(Boolean)
}

function mimeFromScreenshotPath(p) {
  const lower = p.toLowerCase()
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  return 'image/png'
}

function takeFocusedScreenshot(outputPath) {
  mkdirSync(dirname(outputPath), { recursive: true })
  const result = spawnSync('scrot', ['-u', outputPath], { stdio: 'inherit' })
  if (result.error || result.status !== 0) {
    throw new Error(`scrot failed with status ${result.status ?? 'unknown'}`)
  }
}

const args = parseArgs(process.argv.slice(2))
if (args.help) {
  usage()
  process.exit(0)
}

if (!args.channel || !args.userId || !args.threadId) {
  usage()
  console.error('Error: --channel, --user-id, and --thread-id are required')
  process.exit(1)
}
if (!args.summary.trim() && !args.extractedText.trim() && trimList(args.identityHints).length === 0 && trimList(args.relationshipNotes).length === 0) {
  console.error('Error: provide at least one of --summary, --text, --identity-hint, or --relationship-note')
  process.exit(1)
}

const activeWindow = getActiveX11Window()
const pattern = expectedWindowRegex(args.channel)
if (!args.noWindowCheck && pattern && !windowMatches(activeWindow, pattern)) {
  console.error(`Active window does not look like ${args.channel}.`)
  console.error(windowSummary(activeWindow))
  console.error('Focus the target chat window first, or pass --no-window-check.')
  process.exit(1)
}

const screenshotPath =
  args.out.trim() ||
  join(root, 'test-results', 'desktop-context', `${args.channel}-${Date.now()}.png`)

takeFocusedScreenshot(screenshotPath)

const openRouterAnalysis =
  args.openRouterMode === 'on'
    ? true
    : args.openRouterMode === 'off'
      ? false
      : Boolean(process.env.OPENROUTER_API_KEY?.trim())

const payload = {
  userId: args.userId.trim(),
  channel: args.channel.trim(),
  threadId: args.threadId.trim(),
  contactId: args.contactId.trim() || args.threadId.trim(),
  summary: args.summary.trim() || undefined,
  extractedText: args.extractedText.trim() || undefined,
  identityHints: trimList(args.identityHints),
  relationshipNotes: trimList(args.relationshipNotes),
  screenshotPath,
  captureTool: args.captureTool.trim() || 'scrot',
  window: activeWindow ?? undefined,
  openRouterAnalysis,
}

if (openRouterAnalysis) {
  try {
    const buf = readFileSync(screenshotPath)
    const maxBytes = 7 * 1024 * 1024
    if (buf.length > maxBytes) {
      console.warn(`Screenshot is ${buf.length} bytes (max ${maxBytes} for vision); omitting image bytes from request`)
    } else {
      payload.screenshotImageBase64 = buf.toString('base64')
      payload.screenshotMimeType = mimeFromScreenshotPath(screenshotPath)
    }
  } catch (e) {
    console.warn('Could not read screenshot for OpenRouter vision:', e?.message || e)
  }
}

const response = await fetch(`${args.apiBase.replace(/\/$/, '')}/mirachat/ingest/desktop-context`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(payload),
})

const raw = await response.text()
if (!response.ok) {
  console.error(`Ingest failed: ${response.status}`)
  console.error(raw)
  process.exit(1)
}

console.log(raw)
