/**
 * Real UI + real Postgres + real API + real pg-boss worker (no mocks).
 *
 * Prerequisites:
 *   Local PostgreSQL service running and reachable via DATABASE_URL / E2E_DATABASE_URL
 *   npx playwright install chromium   (once)
 *
 * Run from MiraChat/:
 *   npm run test:e2e
 *
 * Ops-console only:
 *   npm run test:e2e:ops
 *
 * Optional: `E2E_DATABASE_URL`. Reuse servers on 4400/4473 only with `PW_REUSE_SERVERS=1`.
 * Shared helpers: `ops-console-helpers.ts` (also used by `ops-console.desktop-automation.pw.ts`).
 */
import { test, expect } from '@playwright/test'
import {
  assertRealStack,
  dismissChromeOverlays,
  openOpsConsole,
  runApproveAndMarkSentFlow,
  seedInboundViaApi,
  seedPendingInboundWithoutWorker,
  sendInboundViaUi,
  setSessionSettings,
  waitForDraftInUi,
} from './ops-console-helpers'

test.describe('Ops console — PRD draft → approve (real stack)', () => {
  test('in-product mission strip surfaces PRD positioning (Proxy Self / bounded delegate)', async ({ page, request }) => {
    const api = await assertRealStack(request)
    await setSessionSettings(page, `${Date.now()}`)
    await openOpsConsole(page, api)
    const strip = page.getByTestId('prd-mission-strip')
    await expect(strip).toBeVisible()
    await expect(strip).toContainText(/Proxy Self/i)
    await expect(strip).toContainText(/bounded delegate/i)
    await expect(strip).toContainText(/Protect intent/i)
  })

  test('sidebar and header use photo avatars (img loads)', async ({ page, request }) => {
    const api = await assertRealStack(request)
    const suffix = `${Date.now()}`
    const session = await setSessionSettings(page, suffix)
    await openOpsConsole(page, api)

    const threadId = `pw-avatar-ui-${suffix}`
    await seedInboundViaApi(request, {
      ...session,
      threadId,
      text: `Avatar UI check for ${threadId}`,
    })
    await waitForDraftInUi(page, threadId)

    const rowImg = page.locator('.thread-item.active .avatar img').first()
    await expect(rowImg).toBeVisible()
    const headImg = page.locator('#headAvatar img').first()
    await expect(headImg).toBeVisible()

    await expect
      .poll(
        async () => rowImg.evaluate((el: HTMLImageElement) => el.naturalWidth > 0),
        { timeout: 20_000 },
      )
      .toBe(true)
    await expect
      .poll(
        async () => headImg.evaluate((el: HTMLImageElement) => el.naturalWidth > 0),
        { timeout: 20_000 },
      )
      .toBe(true)
  })

  test('UI Send (simulate message from contact) → Reply in your tone panel (end-to-end)', async ({ page, request }) => {
    const api = await assertRealStack(request)
    const suffix = `${Date.now()}`
    await setSessionSettings(page, suffix)
    await openOpsConsole(page, api)

    const threadId = `cursor-ui-sim-${suffix}`
    await sendInboundViaUi(page, threadId, `What is next for ${threadId}?`)
    await expect(page.getByRole('button', { name: 'Approve reply' })).toBeVisible({ timeout: 90_000 })
    await expect(page.locator('#approvalPanel')).toContainText(/reply in your tone/i)
    await dismissChromeOverlays(page)
  })

  test('UI Send with blank stored accountId still surfaces draft (mirachatSessionParams before inbound)', async ({
    page,
    request,
  }) => {
    const api = await assertRealStack(request)
    const suffix = `${Date.now()}`
    await page.addInitScript(
      ({ userId, channel }) => {
        localStorage.setItem('mirachatUserId', userId)
        localStorage.setItem('mirachatAccountId', '')
        localStorage.setItem('mirachatChannel', channel)
      },
      { userId: `pw-blank-acc-${suffix}`, channel: 'wechat' },
    )
    await openOpsConsole(page, api)

    const threadId = `cursor-blank-acc-${suffix}`
    await sendInboundViaUi(page, threadId, `what's there to do for ${threadId}`)
    await expect(page.getByRole('button', { name: 'Approve reply' })).toBeVisible({ timeout: 90_000 })
    await expect(page.locator('#approvalPanel')).toContainText(/reply in your tone/i)
    await dismissChromeOverlays(page)
  })

  test('draft → approve → mark sent is visible in the UI', async ({ page, request }) => {
    const api = await assertRealStack(request)
    const suffix = `${Date.now()}`
    const session = await setSessionSettings(page, suffix)
    await openOpsConsole(page, api)

    const threadId = `ui-e2e-${suffix}`
    await seedInboundViaApi(request, {
      ...session,
      threadId,
      text: `Real UI E2E message for ${threadId}`,
    })
    await waitForDraftInUi(page, threadId)

    const panel = page.locator('#approvalPanel')
    await expect(panel).toBeVisible()
    await expect(panel.locator('h3')).toContainText(/reply in your tone/i)
    await expect(page.getByRole('button', { name: 'Approve reply' })).toBeVisible()

    await runApproveAndMarkSentFlow(page)
  })

  test('Send flow: single personalized reply is copyable in Reply in your tone panel', async ({
    page,
    request,
  }) => {
    const api = await assertRealStack(request)
    const suffix = `${Date.now()}`
    const session = await setSessionSettings(page, suffix)
    await openOpsConsole(page, api)

    const threadId = `thread-draft-copy-${suffix}`
    await seedInboundViaApi(request, {
      ...session,
      threadId,
      text: `Need a polished but warm reply for ${threadId}`,
    })
    await waitForDraftInUi(page, threadId)

    const panel = page.locator('#chatThread #approvalPanel')
    await expect(panel).toBeVisible()
    await expect(panel.locator('.appr-suggest-card')).toBeVisible()
    await expect(page.locator('#messages .bubble.thread-draft')).toHaveCount(0)
    const draftTexts = panel.locator('.appr-suggest-text')
    await expect(draftTexts).toHaveCount(1)
    await expect(draftTexts.first()).not.toBeEmpty()
    await expect(draftTexts.first()).toContainText(/\w/)
    await expect(panel).toContainText(/your tone/i)
  })

  test('summarize thread shows in-app summary modal', async ({ page, request }) => {
    const api = await assertRealStack(request)
    const suffix = `${Date.now()}`
    const session = await setSessionSettings(page, suffix)
    await openOpsConsole(page, api)

    const threadId = `summary-e2e-${suffix}`
    await seedInboundViaApi(request, {
      ...session,
      threadId,
      text: `Summarize this thread for ${threadId}`,
    })
    await waitForDraftInUi(page, threadId)

    await page.locator('#btnSummarize').click()
    const modal = page.locator('#summarizeModal')
    await expect(modal).toHaveClass(/show/)
    await expect(page.locator('#summarizeBody')).toBeVisible()
    const body = await page.locator('#summarizeBody').textContent()
    expect((body || '').trim().length).toBeGreaterThan(0)
    expect(body).not.toMatch(/No prior messages/i)
    await page.locator('#summarizeClose').click()
    await expect(modal).toBeHidden()
  })

  test('triage panel shows thread snapshot and single reply (MVP)', async ({ page, request }) => {
    const api = await assertRealStack(request)
    const suffix = `${Date.now()}`
    const session = await setSessionSettings(page, suffix)
    await openOpsConsole(page, api)

    const threadId = `mvp-triage-${suffix}`
    await seedInboundViaApi(request, {
      ...session,
      threadId,
      text: `MVP triage copy check for ${threadId}`,
    })
    await waitForDraftInUi(page, threadId)

    const panel = page.locator('#approvalPanel')
    await expect(panel).toContainText('Reply in your tone')
    await expect(panel.locator('.snapshot-details summary')).toContainText(/Thread snapshot/i)
    await expect(panel.locator('.approval-panel-scroll')).toBeVisible()
    await expect(panel.locator('.appr-suggest-text')).toHaveCount(1)
    await expect(panel.getByRole('button', { name: 'Approve reply' })).toBeVisible()
  })

  test('process pending queue turns waiting messages into drafts (MVP)', async ({ page, request }) => {
    test.setTimeout(240_000)
    const api = await assertRealStack(request)
    const suffix = `${Date.now()}`
    const session = await setSessionSettings(page, suffix)
    const t1 = `queue-a-${suffix}`
    const t2 = `queue-b-${suffix}`
    await seedPendingInboundWithoutWorker({ ...session, threadId: t1, text: `Queue seed A ${suffix}` })
    await seedPendingInboundWithoutWorker({ ...session, threadId: t2, text: `Queue seed B ${suffix}` })

    await openOpsConsole(page, api)
    await page.locator('#btnRefresh').click()
    await dismissChromeOverlays(page)

    const uid = encodeURIComponent(session.userId)
    const ch = encodeURIComponent(session.channel)
    const acc = encodeURIComponent(session.accountId)
    const pendingUrl = `${api}/mirachat/inbox/pending-count?userId=${uid}&channel=${ch}&accountId=${acc}`

    await expect
      .poll(
        async () => {
          const r = await request.get(pendingUrl)
          if (!r.ok()) return -1
          const j = (await r.json()) as { pendingInboundCount?: number }
          return j.pendingInboundCount ?? -1
        },
        { timeout: 15_000 },
      )
      .toBe(2)

    await expect(page.locator('#pendingInboundHint')).toContainText(/2 new messages/i, { timeout: 15_000 })
    await expect(page.locator('#btnProcessPending')).toBeEnabled()

    await page.locator('#btnProcessPending').click()
    await expect(page.locator('#toast')).toContainText(/Queued 2 for drafting/i, { timeout: 15_000 })

    await expect
      .poll(
        async () => {
          const r = await request.get(pendingUrl)
          if (!r.ok()) return -1
          const j = (await r.json()) as { pendingInboundCount?: number }
          return j.pendingInboundCount ?? -1
        },
        { timeout: 90_000 },
      )
      .toBe(0)

    await waitForDraftInUi(page, t1, { timeoutMs: 150_000 })
    await waitForDraftInUi(page, t2, { timeoutMs: 150_000 })

    await page.locator('#btnRefresh').click()
    await dismissChromeOverlays(page)
    await expect(page.locator('#pendingInboundHint')).toContainText(/All caught up/i, {
      timeout: 45_000,
    })
  })

  test('find-a-time flow returns suggested reply and slots', async ({ page, request }) => {
    const api = await assertRealStack(request)
    const suffix = `${Date.now()}`
    const session = await setSessionSettings(page, suffix)
    await openOpsConsole(page, api)

    const threadId = `negotiate-e2e-${suffix}`
    await seedInboundViaApi(request, {
      ...session,
      threadId,
      text: `Can we move this to Thursday afternoon for ${threadId}?`,
    })
    await waitForDraftInUi(page, threadId)

    await page.locator('#btnNegotiate').click()
    await expect(page.locator('#negotiateModal')).toHaveClass(/show/)
    await page.locator('#negPriority').selectOption('high')
    await page.locator('#negPreference').selectOption('afternoon')
    await page.locator('#negConstraints').fill('Need 30 minutes\nAvoid Friday')
    await page.locator('#negotiateRun').click()

    const result = page.locator('#negotiateResult')
    await expect(result).toBeVisible()
    await expect(result).toContainText('Suggested reply')
    await expect(result).toContainText(/Tue|Wed|Thu/)
    await expect(result).toContainText(/high priority|priority:\s*high/i)
    await expect(page.locator('#toast')).toContainText('Negotiation suggestion ready')
  })

  test('saving relationship settings changes the next draft policy outcome', async ({ page, request }) => {
    const api = await assertRealStack(request)
    const suffix = `${Date.now()}`
    const session = await setSessionSettings(page, suffix)
    await openOpsConsole(page, api)

    const threadId = `relationship-e2e-${suffix}`
    await seedInboundViaApi(request, {
      ...session,
      threadId,
      text: `Initial message for ${threadId}`,
    })
    await waitForDraftInUi(page, threadId)

    await page.getByRole('button', { name: 'Reject', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Approve reply' })).toBeHidden({ timeout: 30_000 })

    await page.locator('#btnMenu').click()
    await page.getByRole('button', { name: 'Relationship', exact: true }).click()
    await page.locator('#relRole').fill('board')
    await page.locator('#relTone').fill('formal and board-ready')
    await page.locator('#relRisk').selectOption('high')
    await page.locator('#relNotes').fill('Prioritize precision.')
    await page.locator('#btnSaveRel').click()
    await expect(page.locator('#toast')).toContainText('Relationship saved')

    await seedInboundViaApi(request, {
      ...session,
      threadId,
      text: `Second message after relationship update for ${threadId}`,
    })
    await waitForDraftInUi(page, threadId)
    await expect(page.locator('#approvalPanel')).toContainText(/high-priority/i)
  })

  test('drawer Metrics and Audit load real delegation data after user actions', async ({ page, request }) => {
    const api = await assertRealStack(request)
    const suffix = `${Date.now()}`
    const session = await setSessionSettings(page, suffix)
    await openOpsConsole(page, api)

    const threadId = `metrics-e2e-${suffix}`
    await seedInboundViaApi(request, {
      ...session,
      threadId,
      text: `Metrics and audit seed for ${threadId}`,
    })
    await waitForDraftInUi(page, threadId)
    await page.getByRole('button', { name: 'Approve reply' }).click()

    await page.locator('#btnMenu').click()
    await page.getByRole('button', { name: 'Metrics', exact: true }).click()
    await expect(page.locator('#panel-metrics')).not.toContainText('Loading…', { timeout: 25_000 })
    await expect(page.locator('#panel-metrics')).toContainText(/Approved without edit|Event types/)

    await page.getByRole('button', { name: 'Audit', exact: true }).click()
    await expect(page.locator('#panel-audit')).toBeVisible()
    await expect(page.locator('#panel-audit .log-line').first()).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('#panel-audit')).toContainText(/Draft created|Policy checked|Approved as written/i)
  })

  test('approve via OpenClaw doer executes and records audit events', async ({ page, request }) => {
    const api = await assertRealStack(request)
    const suffix = `${Date.now()}`
    await setSessionSettings(page, suffix, { openClawTo: '+15550000000', openClawThinking: 'minimal' })
    await openOpsConsole(page, api)

    const threadId = `openclaw-e2e-${suffix}`
    await seedInboundViaApi(request, {
      userId: `pw-user-${suffix}`,
      accountId: `pw-account-${suffix}`,
      channel: 'twilio_whatsapp',
      threadId,
      text: `Use the doer path for ${threadId}`,
    })
    await waitForDraftInUi(page, threadId)

    await page.getByRole('button', { name: /Run with OpenClaw/ }).click()
    await expect(page.getByRole('button', { name: 'Approve reply' })).toBeHidden({ timeout: 45_000 })
    await expect(page.locator('#pendingQueue')).toBeHidden()

    await page.locator('#btnMenu').click()
    await page.getByRole('button', { name: 'Audit', exact: true }).click()
    await expect(page.locator('#panel-audit')).toContainText(/OpenClaw run started/i, { timeout: 20_000 })
    await expect(page.locator('#panel-audit')).toContainText(/OpenClaw run finished/i, { timeout: 20_000 })
    await expect(page.locator('#panel-audit')).toContainText(/Reply sent/i, { timeout: 20_000 })
  })

  test('main chrome: refresh, menu drawer, negotiate modal escape, measurement opens', async ({ page, request }) => {
    const api = await assertRealStack(request)
    const suffix = `${Date.now()}`
    const session = await setSessionSettings(page, suffix)
    await openOpsConsole(page, api)

    const threadId = `chrome-ui-${suffix}`
    await sendInboundViaUi(page, threadId, `Chrome UI smoke for ${threadId}`)
    await expect(page.getByRole('button', { name: 'Approve reply' })).toBeVisible({ timeout: 90_000 })

    await page.locator('#btnRefresh').click()
    await dismissChromeOverlays(page)

    await page.locator('#btnNegotiate').click()
    await expect(page.locator('#negotiateModal')).toHaveClass(/show/)
    await page.keyboard.press('Escape')
    await expect(page.locator('#negotiateModal')).toBeHidden()

    await page.locator('#btnMenu').click()
    await expect(page.locator('#overlay')).toHaveClass(/open/)
    await page.locator('#btnCloseDrawer').click()
    await expect(page.locator('#overlay')).not.toHaveClass(/open/)

    const popupPromise = page.waitForEvent('popup')
    await page.locator('#btnMeasurement').click()
    const meas = await popupPromise
    try {
      await expect(meas).toHaveURL(/measurement/i)
    } finally {
      await meas.close()
    }
  })
})
