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
  setSessionSettings,
  waitForDraftInUi,
} from './ops-console-helpers'

test.describe('Ops console — PRD draft → approve (real stack)', () => {
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
    await expect(panel.locator('h3')).toContainText(/pick a reply/i)
    await expect(page.getByRole('button', { name: 'Approve primary' })).toBeVisible()

    await runApproveAndMarkSentFlow(page)
  })

  test('assist modal shows real thread summary and multi-option replies', async ({ page, request }) => {
    const api = await assertRealStack(request)
    const suffix = `${Date.now()}`
    const session = await setSessionSettings(page, suffix)
    await openOpsConsole(page, api)

    const threadId = `assist-e2e-${suffix}`
    await seedInboundViaApi(request, {
      ...session,
      threadId,
      text: `Need a polished but warm reply for ${threadId}`,
    })
    await waitForDraftInUi(page, threadId)

    await page.locator('#btnAssist').click()
    await expect(page.locator('#assistModal')).toHaveClass(/show/)
    await expect(page.locator('#assistBody')).toContainText('Thread summary')
    await expect(page.locator('#assistBody')).toContainText('Primary draft')
    await expect(page.locator('#assistBody')).toContainText(
      /direct|balanced|relationship-first|concise|warm|assertive/i,
    )
    await page.locator('#assistClose').click()
    await expect(page.locator('#assistModal')).not.toHaveClass(/show/)
  })

  test('summarize thread returns a real summary dialog', async ({ page, request }) => {
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

    let dialogMessage = ''
    page.once('dialog', (dialog) => {
      dialogMessage = dialog.message()
      void dialog.accept()
    })
    await page.locator('#btnSummarize').click()
    await expect
      .poll(() => dialogMessage, { timeout: 15_000 })
      .not.toEqual('')
    expect(dialogMessage).not.toMatch(/No prior messages/i)
  })

  test('triage panel shows thread snapshot and tone option picks (MVP)', async ({ page, request }) => {
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
    await expect(panel).toContainText('Pick a reply')
    await expect(panel).toContainText('Thread snapshot')
    await expect(panel.getByRole('button', { name: 'Approve this option' }).first()).toBeVisible()
    const toneLabel = panel.locator('.opt-block .opt-label').first()
    await expect(toneLabel).toContainText(
      /Direct|Balanced|Relationship-first|Concise|Warm|Assertive|Option/i,
    )
  })

  test('process pending queue drains PENDING inbounds into drafts (MVP)', async ({ page, request }) => {
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

    await expect(page.locator('#pendingInboundHint')).toContainText(/2 inbound messages/i, { timeout: 15_000 })
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
    await expect(page.locator('#pendingInboundHint')).toContainText(/Inbound queue clear/i, {
      timeout: 45_000,
    })
  })

  test('relationship-aware scheduling tool returns suggested reply and slots', async ({ page, request }) => {
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
    await expect(result).toContainText(/Priority: high|relationship weight=high/i)
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
    await expect(page.getByRole('button', { name: 'Approve primary' })).toBeHidden({ timeout: 30_000 })

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
    await expect(page.locator('#approvalPanel')).toContainText(/high_risk_relationship/i)
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
    await page.getByRole('button', { name: 'Approve primary' }).click()

    await page.locator('#btnMenu').click()
    await page.getByRole('button', { name: 'Metrics', exact: true }).click()
    await expect(page.locator('#panel-metrics')).not.toContainText('Loading…', { timeout: 25_000 })
    await expect(page.locator('#panel-metrics')).toContainText(/Approved without edit|Event types/)

    await page.getByRole('button', { name: 'Audit', exact: true }).click()
    await expect(page.locator('#panel-audit')).toBeVisible()
    await expect(page.locator('#panel-audit .log-line').first()).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('#panel-audit')).toContainText(/draft\.created|policy\.evaluated|draft\.approved_as_is/i)
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

    await page.getByRole('button', { name: 'Run primary with OpenClaw' }).click()
    await expect(page.getByRole('button', { name: 'Approve primary' })).toBeHidden({ timeout: 45_000 })
    await expect(page.locator('#pendingQueue')).toBeHidden()

    await page.locator('#btnMenu').click()
    await page.getByRole('button', { name: 'Audit', exact: true }).click()
    await expect(page.locator('#panel-audit')).toContainText(/doer\.started/i, { timeout: 20_000 })
    await expect(page.locator('#panel-audit')).toContainText(/doer\.completed/i, { timeout: 20_000 })
    await expect(page.locator('#panel-audit')).toContainText(/outbound\.sent/i, { timeout: 20_000 })
  })
})
