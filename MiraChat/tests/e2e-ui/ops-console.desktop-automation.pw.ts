/**
 * Playwright-driven desktop automation for the ops console (replaces MCP / agent-browser for this flow).
 *
 * Prerequisites: same as other e2e-ui tests — PostgreSQL via DATABASE_URL / E2E_DATABASE_URL.
 *
 * Run (headless, default):
 *   npm run test:e2e:ops -- --grep desktop
 *
 * Run with video capture (headless; works on servers without a display):
 *   npm run test:e2e:desktop
 *
 * True visible Chromium (requires DISPLAY, or e.g. `xvfb-run -a npm run test:e2e:desktop:gui`):
 *   npm run test:e2e:desktop:gui
 *
 * Reuse already-running API + static server (ports must match PLAYWRIGHT_API_BASE + baseURL):
 *   PW_REUSE_SERVERS=1 PLAYWRIGHT_API_BASE=http://127.0.0.1:4000 npm run test:e2e:desktop
 *   (also set baseURL if not 4473, e.g. PW_BASE_URL=http://127.0.0.1:4479 — see playwright.config)
 */
import { test, expect } from '@playwright/test'
import {
  apiBase,
  assertRealStack,
  openOpsConsole,
  runApproveAndMarkSentFlow,
  seedInboundViaApi,
  setSessionSettings,
  waitForDraftInUi,
} from './ops-console-helpers'

test.describe('Ops console — Playwright desktop automation', () => {
  test('full stack: seed inbound, open thread, approve primary, mark sent (toast + queue)', async ({
    page,
    request,
  }) => {
    const api = await assertRealStack(request)
    expect(api).toBe(apiBase())

    const suffix = `desktop-${Date.now()}`
    const session = await setSessionSettings(page, suffix)
    await openOpsConsole(page, api)

    const threadId = `pw-ops-${suffix}`
    await seedInboundViaApi(request, {
      ...session,
      threadId,
      text: `Playwright desktop automation seed for ${threadId}`,
    })
    await waitForDraftInUi(page, threadId)

    await runApproveAndMarkSentFlow(page)

    const row = await request.get(`${api}/mirachat/thread?threadId=${encodeURIComponent(threadId)}`)
    expect(row.ok()).toBeTruthy()
    const body = (await row.json()) as { messages?: { direction: string; content: string }[] }
    expect(Array.isArray(body.messages)).toBe(true)
  })
})
