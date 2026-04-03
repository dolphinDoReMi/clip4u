#!/usr/bin/env node
/**
 * Saves PNG screenshots proving ops-console draft → approve flow (headless).
 * Requires: API :4400 + static ops on :4473 (or set OPS_UI_BASE / OPS_API_BASE).
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'test-results', 'ui-evidence')

const apiBase = process.env.OPS_API_BASE ?? 'http://127.0.0.1:4400'
const uiBase = process.env.OPS_UI_BASE ?? 'http://127.0.0.1:4473'
const threadId = `ui-evidence-${Date.now()}`

async function waitForDraft(maxMs = 90_000) {
  const start = Date.now()
  while (Date.now() - start < maxMs) {
    const r = await fetch(`${apiBase}/mirachat/drafts`)
    if (r.ok) {
      const list = await r.json()
      const hit = Array.isArray(list) ? list.find((d) => d.threadId === threadId) : null
      if (hit) return hit
    }
    await new Promise((r) => setTimeout(r, 1500))
  }
  return null
}

const res = await fetch(`${apiBase}/mirachat/inbound`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    userId: 'demo-user',
    accountId: 'default-account',
    channel: 'twilio_whatsapp',
    contactId: threadId,
    threadId,
    senderId: threadId,
    text: `UI evidence seed — ${threadId}`,
    messageId: `evidence-${threadId}`,
  }),
})
if (!res.ok) {
  console.error('inbound failed', res.status, await res.text())
  process.exit(1)
}

const draft = await waitForDraft()
if (!draft) {
  console.error('No draft for thread after timeout:', threadId)
  process.exit(1)
}

await mkdir(outDir, { recursive: true })
const meta = { threadId, apiBase, uiBase, draftId: draft.id, capturedAt: new Date().toISOString() }
await writeFile(path.join(outDir, 'evidence-meta.json'), JSON.stringify(meta, null, 2), 'utf8')

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const url = `${uiBase.replace(/\/$/, '')}/?api=${encodeURIComponent(apiBase)}`

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
await page.keyboard.press('Escape')
await page.waitForTimeout(200)
await page.locator('#btnRefresh').click()
await page.waitForTimeout(400)

await page.screenshot({ path: path.join(outDir, '01-inbox-after-refresh.png'), fullPage: true })

const row = page.locator('.thread-item').filter({ hasText: threadId }).first()
await row.click({ timeout: 15_000 })
await page.locator('#approvalPanel').waitFor({ state: 'visible', timeout: 30_000 })
await page.screenshot({ path: path.join(outDir, '02-approval-panel.png'), fullPage: true })
await page.locator('#approvalPanel').screenshot({ path: path.join(outDir, '02b-approval-panel-crop.png') })

await page.getByRole('button', { name: 'Approve reply' }).click()
await page.locator('#toast').waitFor({ state: 'visible', timeout: 15_000 })
await page.waitForTimeout(300)
await page.screenshot({ path: path.join(outDir, '03-toast-approved-and-queue.png'), fullPage: true })

await browser.close()

console.log('Evidence written to:', outDir)
console.log(JSON.stringify(meta, null, 2))
