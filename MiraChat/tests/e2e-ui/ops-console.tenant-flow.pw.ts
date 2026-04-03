/**
 * Full-stack multitenant flow: API returns 401 without Bearer; ops console persists token,
 * reconnects, loads threads and Identity when MIRACHAT_TENANT_ENFORCE=1.
 *
 * Run (requires DATABASE_URL / E2E_DATABASE_URL like other Playwright PRD tests):
 *   MIRACHAT_E2E_TENANT=1 npm run test:e2e:ops:tenant
 *
 * Override token map / secret / user together if you change MIRACHAT_E2E_TENANT_TOKEN_MAP:
 *   MIRACHAT_E2E_TENANT_TOKEN_MAP='{"my-secret":"my-user"}' MIRACHAT_E2E_TENANT_SECRET=my-secret MIRACHAT_E2E_TENANT_USER=my-user ...
 */
import { expect, test } from '@playwright/test'
import { assertRealStack, openOpsConsole, seedPendingInboundWithoutWorker } from './ops-console-helpers'

const tenantE2e =
  process.env.MIRACHAT_E2E_TENANT === '1' || process.env.MIRACHAT_E2E_TENANT === 'true'
const TENANT_SECRET = process.env.MIRACHAT_E2E_TENANT_SECRET ?? 'e2e-tenant-ui-secret'
const TENANT_USER = process.env.MIRACHAT_E2E_TENANT_USER ?? 'demo-user'
const TENANT_ACCOUNT = process.env.MIRACHAT_E2E_TENANT_ACCOUNT ?? 'e2e-tenant-acct'
const TENANT_THREAD = process.env.MIRACHAT_E2E_TENANT_THREAD ?? 'e2e-tenant-thread-1'

test.describe('Ops console — tenant bearer (enforced)', () => {
  test.beforeEach(() => {
    test.skip(
      !tenantE2e,
      'Set MIRACHAT_E2E_TENANT=1 so playwright.config starts the API with MIRACHAT_TENANT_ENFORCE=1.',
    )
  })

  test('API 401 without bearer; wrong token 401; UI token + reconnect loads thread and Identity', async ({
    page,
    request,
  }) => {
    const api = await assertRealStack(request)
    const idUrl = `${api}/mirachat/identity?userId=${encodeURIComponent(TENANT_USER)}`

    expect((await request.get(idUrl)).status()).toBe(401)
    expect(
      (await request.get(idUrl, { headers: { Authorization: 'Bearer wrong-token-not-in-map' } })).status(),
    ).toBe(401)
    expect(
      (await request.get(idUrl, { headers: { Authorization: `Bearer ${TENANT_SECRET}` } })).ok(),
    ).toBeTruthy()

    await seedPendingInboundWithoutWorker({
      userId: TENANT_USER,
      accountId: TENANT_ACCOUNT,
      channel: 'twilio_whatsapp',
      threadId: TENANT_THREAD,
      text: 'e2e tenant seed inbound',
    })

    const displayName = `E2E Tenant ${Date.now()}`
    const putId = await request.put(`${api}/mirachat/identity`, {
      headers: {
        Authorization: `Bearer ${TENANT_SECRET}`,
        'Content-Type': 'application/json',
      },
      data: {
        userId: TENANT_USER,
        displayName,
        tone: 'warm',
        styleGuide: ['e2e-style'],
        hardBoundaries: ['e2e-boundary'],
      },
    })
    expect(putId.ok()).toBeTruthy()

    await page.addInitScript(
      ({ userId, accountId, channel }) => {
        localStorage.setItem('mirachatUserId', userId)
        localStorage.setItem('mirachatAccountId', accountId)
        localStorage.setItem('mirachatChannel', channel)
        localStorage.removeItem('mirachatTenantBearer')
      },
      { userId: TENANT_USER, accountId: TENANT_ACCOUNT, channel: 'twilio_whatsapp' },
    )

    await openOpsConsole(page, api)

    await page.locator('#btnMenu').click()
    await expect(page.locator('#mirachatTenantBearer')).toBeVisible()
    await page.locator('#mirachatTenantBearer').fill('wrong-before-good')
    await page.locator('#btnSaveSettings').click()
    await expect(page.locator('#toast')).toBeVisible({ timeout: 20_000 })

    const badStatus = await page.evaluate(
      async ({ apiBase, userId }) => {
        const token = (localStorage.getItem('mirachatTenantBearer') || '').trim()
        const r = await fetch(`${apiBase}/mirachat/identity?userId=${encodeURIComponent(userId)}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
        return r.status
      },
      { apiBase: api, userId: TENANT_USER },
    )
    expect(badStatus).toBe(401)

    await page.locator('#btnMenu').click()
    await expect(page.locator('#mirachatTenantBearer')).toBeVisible()
    await page.locator('#mirachatTenantBearer').fill(TENANT_SECRET)
    await page.locator('#btnSaveSettings').click()
    await expect(page.locator('#toast')).toContainText(/Connected/i, { timeout: 20_000 })

    const okInPage = await page.evaluate(
      async ({ apiBase, userId }) => {
        const token = (localStorage.getItem('mirachatTenantBearer') || '').trim()
        const r = await fetch(`${apiBase}/mirachat/identity?userId=${encodeURIComponent(userId)}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        return r.ok
      },
      { apiBase: api, userId: TENANT_USER },
    )
    expect(okInPage).toBe(true)

    await page.locator('#btnRefresh').click()
    await expect(page.locator(`.thread-item[data-tid="${TENANT_THREAD}"]`).first()).toBeVisible({
      timeout: 30_000,
    })

    await page.locator('#btnMenu').click()
    await page.locator('#drawerTabs .tab[data-tab="identity"]').click()
    await expect(page.locator('#idDisplayName')).toHaveValue(displayName, { timeout: 15_000 })
  })
})
