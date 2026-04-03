
/**
 * Ops console — desktop context ingest + optional OpenRouter analysis (real stack).
 *
 * Prerequisites (same as other ops UI e2e):
 *   DATABASE_URL or E2E_DATABASE_URL in MiraChat/.env
 *   npx playwright install chromium
 *
 * OpenRouter branch (second test):
 *   OPENROUTER_API_KEY (and optionally OPENROUTER_MODEL) in MiraChat/.env
 *   Playwright loads .env via playwright.config.ts; API loads it via load-root-env.
 *
 * Run:
 *   npm run test:e2e:desktop-context
 *
 * If ports 4400 / 4473 are already taken (e.g. old API without desktop ingest), use fresh ports:
 *   PLAYWRIGHT_API_PORT=4405 PLAYWRIGHT_UI_PORT=4475 npm run test:e2e:desktop-context
 *
 * Reuse existing servers only after restarting the API so it includes `POST /mirachat/ingest/desktop-context`:
 *   PW_REUSE_SERVERS=1 npm run test:e2e:desktop-context
 */
import { test, expect } from '@playwright/test'
import { assertRealStack, dismissChromeOverlays, openOpsConsole, setSessionSettings } from './ops-console-helpers'

test.describe('Ops console — desktop context ingest', () => {
  test('Desktop drawer → ingest without OpenRouter (memory chunks only)', async ({ page, request }) => {
    const api = await assertRealStack(request)
    const suffix = `${Date.now()}`
    const session = await setSessionSettings(page, suffix)
    await openOpsConsole(page, api)

    await page.locator('#btnMenu').click()
    await page.locator('#drawerTabs .tab[data-tab="desktop"]').click()
    await expect(page.locator('#panel-desktop')).toBeVisible()

    const threadId = `pw-desktop-${suffix}`
    await page.locator('#desktopIngestThreadId').fill(threadId)
    await page.locator('#desktopIngestSummary').fill(
      `Playwright UI ingest for ${threadId}: colleague asked to confirm Tuesday 3pm; user prefers short acknowledgements.`,
    )
    await page.locator('#desktopIngestOpenRouter').setChecked(false)

    await page.locator('#btnDesktopIngest').click()
    await expect(page.locator('#desktopIngestResult')).toContainText('"ok": true', { timeout: 30_000 })
    await expect(page.locator('#desktopIngestResult')).toContainText('"memoryChunkCount": 1')
    await expect(page.locator('#desktopIngestResult')).toContainText('"openRouterAnalysis": null')
    await expect(page.locator('#desktopIngestResult')).toContainText('"openRouterAnalysisSkippedReason": "disabled"')

    const raw = await page.locator('#desktopIngestResult').textContent()
    const parsed = JSON.parse(raw || '{}') as {
      ok?: boolean
      userId?: string
      memoryChunkCount?: number
    }
    expect(parsed.ok).toBe(true)
    expect(parsed.userId).toBe(session.userId)
    expect(parsed.memoryChunkCount).toBe(1)

    await dismissChromeOverlays(page)
  })

  test('Desktop drawer → upload .txt auto-ingests transcript (OpenRouter off)', async ({ page, request }) => {
    const api = await assertRealStack(request)
    const suffix = `${Date.now()}`
    await setSessionSettings(page, suffix)
    await openOpsConsole(page, api)

    await page.locator('#btnMenu').click()
    await page.locator('#drawerTabs .tab[data-tab="desktop"]').click()

    const threadId = `pw-desktop-upload-${suffix}`
    await page.locator('#desktopIngestThreadId').fill(threadId)
    await page.locator('#desktopIngestOpenRouter').setChecked(false)

    const ingestReq = page.waitForRequest(
      (r) => r.method() === 'POST' && r.url().includes('/mirachat/ingest/desktop-context'),
    )

    const fileBody = 'User: Can we meet at 5?\nAgent: Yes, see you then.\n'
    await page.locator('#desktopContextUpload').setInputFiles({
      name: `pw-chat-${suffix}.txt`,
      mimeType: 'text/plain',
      buffer: Buffer.from(fileBody, 'utf8'),
    })

    const req = await ingestReq
    const posted = req.postDataJSON() as {
      summary?: string
      extractedText?: string
      openRouterAnalysis?: boolean
      screenshotPath?: string
      captureTool?: string
    }
    expect(posted.openRouterAnalysis).toBe(false)
    expect(posted.extractedText).toContain('Can we meet at 5')
    expect(posted.summary).toMatch(/Conversation import from/)
    expect(posted.screenshotPath).toMatch(/^upload:/)
    expect(posted.captureTool).toBe('browser_upload')

    await expect(page.locator('#desktopIngestResult')).toContainText('"ok": true', { timeout: 30_000 })
    await expect(page.locator('#desktopIngestResult')).toContainText('"memoryChunkCount": 2')

    await dismissChromeOverlays(page)
  })

  test('Desktop drawer → ingest with OpenRouter analysis when API key is set', async ({ page, request }) => {
    test.skip(!process.env.OPENROUTER_API_KEY?.trim(), 'Set OPENROUTER_API_KEY in MiraChat/.env to run this test')
    test.setTimeout(120_000)

    const api = await assertRealStack(request)
    const suffix = `${Date.now()}`
    const session = await setSessionSettings(page, suffix)
    await openOpsConsole(page, api)

    await page.locator('#btnMenu').click()
    await page.locator('#drawerTabs .tab[data-tab="desktop"]').click()

    const threadId = `pw-desktop-or-${suffix}`
    await page.locator('#desktopIngestThreadId').fill(threadId)
    await page.locator('#desktopIngestSummary').fill(
      `OpenRouter e2e ${threadId}: Alex wants to reschedule; user said they are free Thursday morning but not Friday.`,
    )
    // OpenRouter is checked by default in the Desktop panel

    await page.locator('#btnDesktopIngest').click()
    await expect(page.locator('#desktopIngestResult')).toContainText('"ok": true', { timeout: 90_000 })
    await expect(page.locator('#desktopIngestResult')).toContainText('"memoryChunkCount": 2')
    await expect(page.locator('#desktopIngestResult')).toContainText('"openRouterAnalysisSkippedReason": null')

    const raw = await page.locator('#desktopIngestResult').textContent()
    const parsed = JSON.parse(raw || '{}') as {
      ok?: boolean
      memoryChunkCount?: number
      openRouterAnalysis?: string | null
      openRouterAnalysisSkippedReason?: string | null
    }
    expect(parsed.ok).toBe(true)
    expect(parsed.memoryChunkCount).toBe(2)
    expect(parsed.openRouterAnalysisSkippedReason).toBeNull()
    expect(parsed.openRouterAnalysis && parsed.openRouterAnalysis.length > 20).toBe(true)
  })
})
