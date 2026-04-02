import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import pg from 'pg'
import { ensureDatabaseExists } from './ensure-database.js'
import { runMigrations } from './migrate.js'

const mirachatRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const envPath = resolve(mirachatRoot, '.env')
if (existsSync(envPath)) {
  config({ path: envPath })
}

const connectionString = process.env.DATABASE_URL?.trim()
if (!connectionString) {
  const hint = [
    'DATABASE_URL is not set.',
    `Set it in ${envPath} (variable names are listed in env.vars.txt at the repo root).`,
    'Example: postgresql://USER:PASS@127.0.0.1:5432/mirachat',
  ].join('\n')
  console.error(hint)
  process.exit(1)
}

const skipEnsure = /^(1|true|yes)$/i.test(process.env.MIRACHAT_SKIP_ENSURE_DATABASE?.trim() ?? '')
if (skipEnsure) {
  console.log('MIRACHAT_SKIP_ENSURE_DATABASE set — skipping create-database step')
} else {
  await ensureDatabaseExists(connectionString)
}

const pool = new pg.Pool({ connectionString })
await runMigrations(pool)
await pool.end()
console.log('migrations applied')
