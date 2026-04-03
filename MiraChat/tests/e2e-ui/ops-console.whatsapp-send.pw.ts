/**
 * Drive Twilio WhatsApp simulate-inbound from the ops console UI (sim thread field + Send),
 * then approve primary. Real delivery after “Mark sent” needs `gateway-twilio` / dev:twilio.
 *
 * Uses synthetic thread id by default. Set TWILIO_TEST_TO (+ TWILIO_ACCOUNT_SID or E2E_TWILIO_ACCOUNT_SID)
 * to exercise the same UI path against your sandbox recipient and Twilio account id.
 */
import { test, expect } from '@playwright/test'
import {
  assertRealStack,
  openOpsConsole,
  sendInboundViaUi,
  waitForDraftInUi,
} from './ops-console-helpers'

test.describe('Ops console — WhatsApp simulate inbound (UI)', () => {
  test('sim thread id + Send → draft → Approve primary → pending queue', async ({
    page,
    request,
  }) => {
    const api = await assertRealStack(request)
    const suffix = `${Date.now()}`
    const accountId =
      process.env.E2E_TWILIO_ACCOUNT_SID?.trim() ||
      process.env.TWILIO_ACCOUNT_SID?.trim() ||
      `pw-account-${suffix}`
    const threadId =
      process.env.TWILIO_TEST_TO?.trim() || `wa-ui-thread-${suffix}`

    await page.addInitScript(
      ({ userId, accountId: acc, channel, simThreadId }) => {
        localStorage.setItem('mirachatUserId', userId)
        localStorage.setItem('mirachatAccountId', acc)
        localStorage.setItem('mirachatChannel', channel)
        localStorage.setItem('mirachatSimThreadId', simThreadId)
      },
      {
        userId: `pw-wa-ui-${suffix}`,
        accountId,
        channel: 'twilio_whatsapp',
        simThreadId: threadId,
      },
    )

    await openOpsConsole(page, api)

    await expect(page.locator('#simThreadId')).toHaveValue(threadId)
    await expect(page.locator('#channel')).toHaveValue('twilio_whatsapp')

    const text = `UI WhatsApp simulate ${suffix}`
    await sendInboundViaUi(page, '', text)

    await waitForDraftInUi(page, threadId)

    await expect(page.locator('#approvalPanel')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Approve primary' })).toBeVisible()

    await page.getByRole('button', { name: 'Approve primary' }).click()
    await expect(page.locator('#toast')).toContainText(/Approved/i, { timeout: 12_000 })
    await expect(page.locator('#pendingQueue .btn-mark').first()).toBeVisible({ timeout: 30_000 })
  })
})
