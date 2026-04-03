import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { config as loadEnv } from 'dotenv'

const root = path.dirname(fileURLToPath(import.meta.url))
const rootEnv = path.join(root, '.env')
if (existsSync(rootEnv)) {
  loadEnv({ path: rootEnv })
}

const databaseUrl = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL
const retries = Number(process.env.PLAYWRIGHT_RETRIES ?? '0')

const playwrightApiPort = process.env.PLAYWRIGHT_API_PORT ?? '4400'
/** API base for `request` fixture + ops-console-helpers (must match webServer PORT when not reusing). */
const playwrightApiBase =
  process.env.PLAYWRIGHT_API_BASE ?? `http://127.0.0.1:${playwrightApiPort}`
process.env.PLAYWRIGHT_API_BASE = playwrightApiBase

const playwrightUiPort = process.env.PLAYWRIGHT_UI_PORT ?? '4473'
const uiBaseUrl =
  process.env.PW_BASE_URL ?? `http://127.0.0.1:${playwrightUiPort}`
/** True windowed browser (needs DISPLAY / X11 / Wayland). */
const headed = process.env.PW_HEADED === '1' || process.env.PW_HEADED === 'true'
/** Slow every action by N ms so you can follow along in headed Chromium (e.g. PW_SLOW_MO=400). */
const slowMoMs = Number(process.env.PW_SLOW_MO ?? '0')
/** Full trace zip after each run — open with `npx playwright show-trace trace.zip` (PW_TRACE=1). */
const traceMode =
  process.env.PW_TRACE === '1' || process.env.PW_TRACE === 'true'
    ? 'on'
    : 'on-first-retry'
/** Record video for desktop-flow specs; does not require a display when headless. */
const recordDesktopVideo =
  process.env.PW_DESKTOP === '1' ||
  process.env.PW_DESKTOP === 'true' ||
  process.env.PW_VIDEO === '1'

/** When set, the API webServer starts with tenant enforcement + a token map for ops-console E2E. */
const mirachatE2eTenant =
  process.env.MIRACHAT_E2E_TENANT === '1' || process.env.MIRACHAT_E2E_TENANT === 'true'

export default defineConfig({
  testDir: path.join(root, 'tests/e2e-ui'),
  testMatch: '**/*.pw.ts',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 45_000 },
  globalSetup: path.join(root, 'tests/e2e-ui/global-setup.mjs'),
  use: {
    baseURL: uiBaseUrl,
    headless: !headed,
    trace: traceMode,
    screenshot: 'only-on-failure',
    video: recordDesktopVideo ? 'on' : 'off',
    launchOptions: {
      ...(slowMoMs > 0 ? { slowMo: slowMoMs } : {}),
      env: {
        ...process.env,
        PLAYWRIGHT_API_BASE: playwrightApiBase,
      },
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npm run build:packages && npm run dev --workspace @delegate-ai/api',
      cwd: root,
      env: {
        ...process.env,
        ...(databaseUrl ? { DATABASE_URL: databaseUrl } : {}),
        PORT: playwrightApiPort,
        ...(mirachatE2eTenant
          ? {
              MIRACHAT_TENANT_TOKEN_MAP:
                process.env.MIRACHAT_E2E_TENANT_TOKEN_MAP ??
                '{"e2e-tenant-ui-secret":"demo-user"}',
            }
          : {}),
      },
      url: `${playwrightApiBase.replace(/\/$/, '')}/health/mirachat-worker`,
      reuseExistingServer: process.env.PW_REUSE_SERVERS === '1',
      timeout: 120_000,
    },
    {
      command: `npm run build --workspace @delegate-ai/ops-console && npx --yes serve apps/ops-console/dist -l ${playwrightUiPort}`,
      cwd: root,
      url: uiBaseUrl,
      reuseExistingServer: process.env.PW_REUSE_SERVERS === '1',
      timeout: 60_000,
    },
  ],
})
