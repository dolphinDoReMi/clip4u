#!/usr/bin/env node
/**
 * Send a message via **WhatsApp Web** (Playwright) — reliable on **Wayland** where nut.js cannot see WhatsApp Desktop.
 *
 * First run: a Chromium window opens; scan the QR code once. Session is saved under ~/.cache/mirachat-whatsapp-web/
 *
 * Usage (from MiraChat/):
 *   npm run whatsapp:web-send -- --contact "tennis group" --message "I am ok"
 *
 * Prefers a system Chromium executable when present (for example `/snap/bin/chromium` on Linux arm64).
 * Set `--browser` or `CHROME_BIN` to override. Falls back to Playwright's bundled browser if needed.
 */
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { chromium } from 'playwright'

function parseArgs(argv) {
  const out = { browser: '', contact: '', message: '', timeoutMs: 300_000, help: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--browser') out.browser = String(argv[++i] ?? '')
    else if (a === '--contact' || a === '-c') out.contact = String(argv[++i] ?? '')
    else if (a === '--message' || a === '-m') out.message = String(argv[++i] ?? '')
    else if (a === '--timeout-ms') out.timeoutMs = Number(argv[++i] ?? '300000') || 300_000
    else if (a === '--help' || a === '-h') out.help = true
  }
  return out
}

function resolveChromiumPath(explicitPath) {
  const candidates = [
    explicitPath,
    process.env.CHROME_BIN,
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/usr/bin/chromium',
  ].filter(Boolean)

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  return undefined
}

function resolveUserDataDir(browserPath) {
  if (
    browserPath === '/usr/bin/chromium-browser' ||
    browserPath === '/snap/bin/chromium'
  ) {
    return join(homedir(), 'snap', 'chromium', 'common', 'mirachat-whatsapp-web')
  }
  return join(homedir(), '.cache', 'mirachat-whatsapp-web')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(`Usage: node scripts/whatsapp-web-send.mjs --contact "chat name" --message "text"

      --browser    System Chromium/Chrome executable path (optional)
  -c, --contact    Search string (chat or group name)
  -m, --message    Message body
      --timeout-ms Max wait for login + UI (default 300000; first run needs QR scan)`)
    process.exit(0)
  }
  if (!args.contact.trim() || !args.message.trim()) {
    console.error('Error: need --contact and --message')
    process.exit(1)
  }

  const browserPath = resolveChromiumPath(args.browser)
  const userDataDir = resolveUserDataDir(browserPath)
  console.error(
    `[whatsapp-web] Launching Chromium (persistent profile) using ${browserPath ?? 'Playwright bundled Chromium'} with profile ${userDataDir}…`,
  )
  mkdirSync(userDataDir, { recursive: true })

  const context = await chromium.launchPersistentContext(userDataDir, {
    ...(browserPath ? { executablePath: browserPath } : {}),
    headless: false,
    viewport: { width: 1280, height: 800 },
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-setuid-sandbox'],
  })

  const page = context.pages()[0] ?? (await context.newPage())
  page.setDefaultTimeout(args.timeoutMs)
  page.setDefaultNavigationTimeout(args.timeoutMs)

  try {
    await page.goto('https://web.whatsapp.com/', {
      waitUntil: 'domcontentloaded',
      timeout: args.timeoutMs,
    })

    const searchBtn = page.getByRole('button', { name: /search|new chat/i })

    console.error(
      '[whatsapp-web] If you see a QR code, scan it with your phone. Waiting for logged-in UI…',
    )
    try {
      await page.waitForFunction(
        () => {
          const d = document
          if (d.querySelector('[data-testid="chat-list-search"]')) return true
          if (d.querySelector('[data-testid="chat-list-search-terminal"]')) return true
          if (d.querySelector('[aria-label="Search input textbox"]')) return true
          if (d.querySelector('[aria-label="Search"]')) return true
          if (d.querySelector('div[aria-label="Chat list"]')) return true
          if (d.querySelector('#pane-side [contenteditable="true"]')) return true
          if (d.querySelector('header span[data-icon="search"]')) return true
          if (d.querySelector('span[data-icon="search-alt"]')) return true
          return false
        },
        { timeout: args.timeoutMs },
      )
    } catch {
      mkdirSync(userDataDir, { recursive: true })
      const shot = join(userDataDir, 'last-failure.png')
      await page.screenshot({ path: shot, fullPage: true }).catch(() => {})
      const url = page.url()
      throw new Error(
        `WhatsApp Web did not become ready (url=${url}). Scan QR in the Chromium window, then re-run. Screenshot: ${shot}`,
      )
    }

    // Open search: button or sidebar search box
    const searchSelectors = [
      () => page.locator('[data-testid="chat-list-search"]').first(),
      () => page.getByRole('button', { name: /search or start new chat/i }),
      () => page.getByTitle('Search input textbox'),
      () => page.locator('div[contenteditable="true"][data-tab="3"]'),
    ]

    let searchBox = null
    for (const mk of searchSelectors) {
      const loc = mk()
      try {
        await loc.waitFor({ state: 'visible', timeout: 8000 })
        searchBox = loc
        break
      } catch {
        /* try next */
      }
    }
    if (!searchBox) {
      await searchBtn.click().catch(() => {})
      await sleep(500)
      searchBox = page.locator('[data-testid="chat-list-search"]').first()
      await searchBox.waitFor({ state: 'visible', timeout: 15_000 })
    }

    await searchBox.click()
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Backspace')
    await searchBox.fill(args.contact.trim())
    await sleep(800)
    await page.keyboard.press('Enter')
    await sleep(400)
    await page.locator('[data-testid="cell-frame-container"]').first().click().catch(() => {})
    await sleep(900)

    // Composer
    const composeSelectors = [
      () => page.locator('[data-testid="conversation-compose-box-input"]'),
      () => page.locator('footer div[contenteditable="true"][role="textbox"]'),
      () => page.getByRole('textbox', { name: /type a message/i }),
    ]

    let compose = null
    for (const mk of composeSelectors) {
      const loc = mk()
      try {
        await loc.waitFor({ state: 'visible', timeout: 12_000 })
        compose = loc
        break
      } catch {
        /* next */
      }
    }
    if (!compose) throw new Error('Could not find message input — open the right chat manually and retry.')

    await compose.click()
    await compose.fill(args.message)
    await page.keyboard.press('Enter')
    await sleep(800)

    console.error('[whatsapp-web] Sent.')
  } finally {
    await context.close()
  }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
