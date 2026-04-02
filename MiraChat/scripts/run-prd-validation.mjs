import { execSync } from 'node:child_process'

const databaseUrl = process.env.E2E_DATABASE_URL || process.env.DATABASE_URL

if (!databaseUrl) {
  console.error('PRD validation requires a real PostgreSQL database with pgvector.')
  console.error('Set E2E_DATABASE_URL or DATABASE_URL, then rerun `npm run test:prd`.')
  process.exit(1)
}

const run = command => {
  execSync(command, {
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: process.env.DATABASE_URL || databaseUrl,
      E2E_DATABASE_URL: process.env.E2E_DATABASE_URL || databaseUrl,
    },
  })
}

const killPortIfBusy = port => {
  try {
    const output = execSync(`lsof -i :${port} -t`, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
    if (!output) {
      return
    }
    const pids = output.split(/\s+/).filter(Boolean)
    if (pids.length > 0) {
      execSync(`kill ${pids.join(' ')}`, { stdio: 'ignore' })
    }
  } catch {
    // Port is free or lsof is unavailable; continue.
  }
}

console.log('Running real PRD/GQM validation (no mocks, no Docker dependency in test design)...')
run('npm run test:prd:db')
killPortIfBusy(4400)
killPortIfBusy(4473)
run('npm run test:e2e')
