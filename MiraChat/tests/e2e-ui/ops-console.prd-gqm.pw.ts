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
 * Optional: `E2E_DATABASE_URL`. Reuse servers on 4400/4473 only with `PW_REUSE_SERVERS=1`.
 */
import { test, expect, type APIRequestContext, type Page } from '@playwright/test'

const apiBase = () => 'http://127.0.0.1:4400'

const assertRealStack = async (request: APIRequestContext) => {
  const api = apiBase()
  let workerJson: { ok?: boolean; mirachat?: boolean; workerReady?: boolean } | null = null
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      const ready = await request.get(`${api}/health/mirachat-worker`)
      if (!ready.ok()) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
        continue
      }
      const j = (await ready.json()) as { ok?: boolean; mirachat?: boolean; workerReady?: boolean }
      if (j.ok && j.mirachat === true && j.workerReady === true) {
        workerJson = j
        break
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  expect(workerJson).not.toBeNull()
  expect(workerJson?.mirachat).toBe(true)
  expect(workerJson?.workerReady).toBe(true)
  return api
}

const seedInboundViaApi = async (
  request: APIRequestContext,
  params: {
    userId: string
    accountId: string
    channel: string
    threadId: string
    text: string
  },
) => {
  const res = await request.post(`${apiBase()}/mirachat/inbound`, {
    data: {
      userId: params.userId,
      accountId: params.accountId,
      channel: params.channel,
      contactId: params.threadId,
      threadId: params.threadId,
      senderId: params.threadId,
      text: params.text,
      messageId: `pw-${Date.now()}`,
    },
  })
  expect(res.ok()).toBeTruthy()
}

const openApp = async (page: Page, api: string) => {
  let opened = false
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await page.goto(`/?api=${encodeURIComponent(api)}`, {
        waitUntil: 'domcontentloaded',
        timeout: 15_000,
      })
      opened = true
      break
    } catch {}
    await page.waitForTimeout(1000)
  }
  expect(opened).toBe(true)
  await expect(page.locator('#healthPill')).toContainText(/DB online/i, { timeout: 45_000 })
}

const setSessionSettings = async (
  page: Page,
  suffix: string,
  options?: {
    openClawTo?: string
    openClawAgentId?: string
    openClawThinking?: string
  },
) => {
  const session = {
    userId: `pw-user-${suffix}`,
    accountId: `pw-account-${suffix}`,
    channel: 'twilio_whatsapp',
  }
  await page.addInitScript(
    ({ userId, accountId, channel, openClawTo, openClawAgentId, openClawThinking }) => {
      localStorage.setItem('mirachatUserId', userId)
      localStorage.setItem('mirachatAccountId', accountId)
      localStorage.setItem('mirachatChannel', channel)
      if (openClawTo) localStorage.setItem('mirachatOpenClawTo', openClawTo)
      if (openClawAgentId) localStorage.setItem('mirachatOpenClawAgentId', openClawAgentId)
      if (openClawThinking) localStorage.setItem('mirachatOpenClawThinking', openClawThinking)
    },
    {
      ...session,
      openClawTo: options?.openClawTo ?? '',
      openClawAgentId: options?.openClawAgentId ?? '',
      openClawThinking: options?.openClawThinking ?? '',
    },
  )
  return session
}

const waitForDraftInUi = async (page: Page, threadId: string) => {
  await expect
    .poll(
      async () => {
        await page.locator('#btnRefresh').click()
        const thread = page.locator('.thread-item').filter({ hasText: threadId }).first()
        if ((await thread.count()) === 0) {
          return false
        }
        await thread.click()
        return await page.getByRole('button', { name: 'Approve primary' }).isVisible()
      },
      { timeout: 90_000, intervals: [500, 1000, 2000] },
    )
    .toBe(true)
}

const sendInboundViaUi = async (page: Page, threadId: string, text: string) => {
  const hasSelection = ((await page.locator('#headTitle').textContent()) || '').trim() !== 'New conversation'
  if (!hasSelection) {
    page.once('dialog', dialog => void dialog.accept(threadId))
  }
  await page.locator('#composer').fill(text)
  await page.locator('#btnInbound').click()
}

test.describe('Ops console — PRD draft → approve (real stack)', () => {
  test('draft → approve → mark sent is visible in the UI', async ({ page, request }) => {
    const api = await assertRealStack(request)
    const suffix = `${Date.now()}`
    const session = await setSessionSettings(page, suffix)
    await openApp(page, api)

    const threadId = `ui-e2e-${suffix}`
    await seedInboundViaApi(request, {
      ...session,
      threadId,
      text: `Real UI E2E message for ${threadId}`,
    })
    await waitForDraftInUi(page, threadId)

    const panel = page.locator('#approvalPanel')
    await expect(panel).toBeVisible()
    await expect(panel.locator('h3')).toContainText(/draft/i)
    await expect(page.getByRole('button', { name: 'Approve primary' })).toBeVisible()

    await page.getByRole('button', { name: 'Approve primary' }).click()
    await expect(page.locator('#pendingQueue .btn-mark').first()).toBeVisible({ timeout: 30_000 })

    await page.locator('#pendingQueue .btn-mark').first().click()
    await expect(page.locator('#pendingQueue')).toBeHidden({ timeout: 30_000 })
    await expect(page.getByRole('button', { name: 'Approve primary' })).toBeHidden()
  })

  test('assist modal shows real thread summary and multi-option replies', async ({ page, request }) => {
    const api = await assertRealStack(request)
    const suffix = `${Date.now()}`
    const session = await setSessionSettings(page, suffix)
    await openApp(page, api)

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
    await expect(page.locator('#assistBody')).toContainText(/concise|warm|assertive/i)
    await page.locator('#assistClose').click()
    await expect(page.locator('#assistModal')).not.toHaveClass(/show/)
  })

  test('summarize thread returns a real summary dialog', async ({ page, request }) => {
    const api = await assertRealStack(request)
    const suffix = `${Date.now()}`
    const session = await setSessionSettings(page, suffix)
    await openApp(page, api)

    const threadId = `summary-e2e-${suffix}`
    await seedInboundViaApi(request, {
      ...session,
      threadId,
      text: `Summarize this thread for ${threadId}`,
    })
    await waitForDraftInUi(page, threadId)

    let dialogMessage = ''
    page.once('dialog', dialog => {
      dialogMessage = dialog.message()
      void dialog.accept()
    })
    await page.locator('#btnSummarize').click()
    await expect
      .poll(() => dialogMessage, { timeout: 15_000 })
      .not.toEqual('')
    expect(dialogMessage).not.toMatch(/No prior messages/i)
  })

  test('relationship-aware scheduling tool returns suggested reply and slots', async ({ page, request }) => {
    const api = await assertRealStack(request)
    const suffix = `${Date.now()}`
    const session = await setSessionSettings(page, suffix)
    await openApp(page, api)

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
    await openApp(page, api)

    const threadId = `relationship-e2e-${suffix}`
    await seedInboundViaApi(request, {
      ...session,
      threadId,
      text: `Initial message for ${threadId}`,
    })
    await waitForDraftInUi(page, threadId)

    await page.getByRole('button', { name: 'Reject' }).click()
    await expect(page.getByRole('button', { name: 'Approve primary' })).toBeHidden({ timeout: 30_000 })

    await page.locator('#btnMenu').click()
    await page.getByRole('button', { name: 'Relationship' }).click()
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
    await openApp(page, api)

    const threadId = `metrics-e2e-${suffix}`
    await seedInboundViaApi(request, {
      ...session,
      threadId,
      text: `Metrics and audit seed for ${threadId}`,
    })
    await waitForDraftInUi(page, threadId)
    await page.getByRole('button', { name: 'Approve primary' }).click()

    await page.locator('#btnMenu').click()
    await page.getByRole('button', { name: 'Metrics' }).click()
    await expect(page.locator('#panel-metrics')).not.toContainText('Loading…', { timeout: 25_000 })
    await expect(page.locator('#panel-metrics')).toContainText(/Approved without edit|Event types/)

    await page.getByRole('button', { name: 'Audit' }).click()
    await expect(page.locator('#panel-audit')).toBeVisible()
    await expect(page.locator('#panel-audit .log-line').first()).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('#panel-audit')).toContainText(/draft\.created|policy\.evaluated|draft\.approved_as_is/i)
  })

  test('approve via OpenClaw doer executes and records audit events', async ({ page, request }) => {
    const api = await assertRealStack(request)
    const suffix = `${Date.now()}`
    await setSessionSettings(page, suffix, { openClawTo: '+15550000000', openClawThinking: 'minimal' })
    await openApp(page, api)

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
    await page.getByRole('button', { name: 'Audit' }).click()
    await expect(page.locator('#panel-audit')).toContainText(/doer\.started/i, { timeout: 20_000 })
    await expect(page.locator('#panel-audit')).toContainText(/doer\.completed/i, { timeout: 20_000 })
    await expect(page.locator('#panel-audit')).toContainText(/outbound\.sent/i, { timeout: 20_000 })
  })
})
