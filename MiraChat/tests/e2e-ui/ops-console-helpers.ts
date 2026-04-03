/**
 * Shared Playwright helpers for the MiraChat ops console (static SPA on baseURL).
 * Use these instead of ad-hoc MCP browser steps for repeatable full-stack UI automation.
 */
import pg from 'pg'
import { expect, type APIRequestContext, type Page } from '@playwright/test'
import { getUserConnection, insertInboundMessage, upsertUserConnection } from '@delegate-ai/db'

export function apiBase(): string {
  return (
    process.env.PLAYWRIGHT_API_BASE ||
    process.env.E2E_API_BASE ||
    'http://127.0.0.1:4400'
  )
}

export const assertRealStack = async (request: APIRequestContext) => {
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

const e2ePoolHolder: { pool?: pg.Pool } = {}

/** Real Postgres pool for E2E-only seeds (same URL as Playwright `webServer`). */
export function getE2ePgPool(): pg.Pool {
  const conn = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL
  if (!conn) {
    throw new Error('E2E_DATABASE_URL or DATABASE_URL must be set for DB seed helpers')
  }
  if (!e2ePoolHolder.pool) {
    e2ePoolHolder.pool = new pg.Pool({ connectionString: conn })
  }
  return e2ePoolHolder.pool!
}

/**
 * Insert a PENDING inbound row without enqueueing pg-boss (for “process queue” MVP tests).
 * Pair with `POST /mirachat/inbox/process-pending` or UI “Generate replies for queue”.
 */
export const seedPendingInboundWithoutWorker = async (params: {
  userId: string
  accountId: string
  channel: string
  threadId: string
  text: string
}): Promise<string> => {
  const pool = getE2ePgPool()
  await upsertUserConnection(pool, {
    channel: params.channel,
    accountId: params.accountId,
    userId: params.userId,
    status: 'ONLINE',
  })
  const connRow = await getUserConnection(pool, params.channel, params.accountId)
  return insertInboundMessage(pool, {
    userConnectionId: connRow?.id ?? null,
    contactId: params.threadId,
    roomId: null,
    threadId: params.threadId,
    rawText: params.text,
    channel: params.channel,
    accountId: params.accountId,
    userId: params.userId,
    senderId: params.threadId,
    messageId: `pw-pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  })
}

export const seedInboundViaApi = async (
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

/** Close connection drawer / overlays so thread list is visible (mobile + desktop). */
export async function dismissChromeOverlays(page: Page) {
  const ingestDismiss = page.locator('#ingestFlowInlineDismiss')
  try {
    if (await ingestDismiss.isVisible()) {
      await ingestDismiss.click()
      await page.waitForTimeout(120)
    }
  } catch {
    /* ignore */
  }
  const ingestClose = page.locator('#ingestFlowClose')
  try {
    if (await ingestClose.isVisible()) {
      await ingestClose.click()
      await page.waitForTimeout(120)
    }
  } catch {
    /* ignore */
  }
  await page.keyboard.press('Escape')
  await page.waitForTimeout(150)
}

/**
 * Open ops console with API base query param and wait for DB health.
 * Press Escape once so the connection drawer does not hide thread rows from automation.
 */
export async function openOpsConsole(page: Page, api: string) {
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
  await dismissChromeOverlays(page)
  /** Pill shows History on (current) or DB online (older builds); refresh if still on initial “API …”. */
  await expect
    .poll(
      async () => {
        const pill = page.locator('#healthPill')
        const t = ((await pill.textContent()) || '').trim()
        if (/History on|DB online/i.test(t)) {
          return t
        }
        await page.locator('#btnRefresh').click()
        await page.waitForTimeout(600)
        return ((await pill.textContent()) || '').trim()
      },
      { timeout: 90_000, intervals: [400, 800, 1200, 2000, 3000] },
    )
    .toMatch(/History on|DB online/i)
}

export const setSessionSettings = async (
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

export const waitForDraftInUi = async (page: Page, threadId: string, options?: { timeoutMs?: number }) => {
  const timeoutMs = options?.timeoutMs ?? 90_000
  /** Row title is a generated persona name; `data-tid` is the real thread id. */
  const threadRow = page.locator(`.thread-item[data-tid="${threadId}"]`).first()
  await expect
    .poll(
      async () => {
        await page.locator('#btnRefresh').click()
        await dismissChromeOverlays(page)
        if ((await threadRow.count()) === 0) {
          return false
        }
        await threadRow.click()
        return await page.getByRole('button', { name: 'Approve reply' }).isVisible()
      },
      { timeout: timeoutMs, intervals: [500, 1000, 2000, 3000] },
    )
    .toBe(true)
}

export const sendInboundViaUi = async (page: Page, threadId: string, text: string) => {
  if (threadId) {
    await page.locator('#simThreadId').fill(threadId)
  }
  const hasSelection = ((await page.locator('#headTitle').textContent()) || '').trim() !== 'New conversation'
  const simFromField = ((await page.locator('#simThreadId').inputValue().catch(() => '')) || '').trim()
  if (!hasSelection && !threadId && !simFromField) {
    page.once('dialog', (dialog) => void dialog.accept('demo-contact'))
  }
  await page.locator('#composer').fill(text)
  await page.locator('#btnInbound').click()
}

/**
 * Full human-in-the-loop strip: Approve reply → pending queue → Mark sent.
 * Asserts success toasts ("Approved…", "Marked sent") and that the approval panel clears.
 */
export async function runApproveAndMarkSentFlow(page: Page) {
  await expect(page.locator('#approvalPanel')).toBeVisible()
  await page.getByRole('button', { name: 'Approve reply' }).click()
  await expect(page.locator('#toast')).toContainText(/Approved/i, { timeout: 12_000 })
  await expect(page.locator('#pendingQueue .btn-mark').first()).toBeVisible({ timeout: 30_000 })
  await page.locator('#pendingQueue .btn-mark').first().click()
  await expect(page.locator('#toast')).toContainText(/Marked sent/i, { timeout: 12_000 })
  await expect(page.locator('#pendingQueue')).toBeHidden({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'Approve reply' })).toBeHidden()
}
