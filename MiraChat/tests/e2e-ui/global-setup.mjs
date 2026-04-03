/**
 * Build workspace packages and ops-console static assets before Playwright starts servers.
 */
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..')

export default async function globalSetup() {
  if (!process.env.E2E_DATABASE_URL && !process.env.DATABASE_URL) {
    throw new Error(
      'Playwright PRD validation requires E2E_DATABASE_URL or DATABASE_URL pointing to a real PostgreSQL + pgvector instance.',
    )
  }
  execSync(
    [
      'npm run build --workspace @delegate-ai/adapter-types',
      'npm run build --workspace @delegate-ai/db',
      'npm run build --workspace @delegate-ai/identity',
      'npm run build --workspace @delegate-ai/memory',
      'npm run build --workspace @delegate-ai/approval',
      'npm run build --workspace @delegate-ai/policy-engine',
      'npm run build --workspace @delegate-ai/negotiation-tools',
      'npm run build --workspace @delegate-ai/openclaw-doer',
      'npm run build --workspace @delegate-ai/twilio-voice-notify',
      'npm run build --workspace @delegate-ai/assist-core',
      'npm run build --workspace @delegate-ai/agent-core',
    ].join(' && '),
    { cwd: root, stdio: 'inherit' },
  )
  execSync('npm run build --workspace @delegate-ai/ops-console', { cwd: root, stdio: 'inherit' })
}
