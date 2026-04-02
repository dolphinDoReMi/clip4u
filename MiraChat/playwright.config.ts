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

export default defineConfig({
  testDir: path.join(root, 'tests/e2e-ui'),
  testMatch: '**/*.pw.ts',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 45_000 },
  globalSetup: path.join(root, 'tests/e2e-ui/global-setup.mjs'),
  use: {
    baseURL: 'http://127.0.0.1:4473',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    launchOptions: {
      env: {
        ...process.env,
        PLAYWRIGHT_API_BASE: process.env.PLAYWRIGHT_API_BASE ?? 'http://127.0.0.1:4400',
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
        PORT: '4400',
      },
      url: 'http://127.0.0.1:4400/health',
      reuseExistingServer: process.env.PW_REUSE_SERVERS === '1',
      timeout: 120_000,
    },
    {
      command: 'npm run build --workspace @delegate-ai/ops-console && npx --yes serve apps/ops-console/dist -l 4473',
      cwd: root,
      url: 'http://127.0.0.1:4473',
      reuseExistingServer: process.env.PW_REUSE_SERVERS === '1',
      timeout: 60_000,
    },
  ],
})
