import './load-root-env.js'
import { createServer } from 'node:http'
import { createInMemoryRuntime } from '@delegate-ai/agent-core'
import {
  createBoss,
  runMigrations,
  startMirachatBoss,
  PostgresIdentityService,
  PostgresMemoryService,
} from '@delegate-ai/db'
import pg from 'pg'
import type PgBoss from 'pg-boss'
import { createDelegateApiListener, type MirachatSqlContext } from './api-listener.js'
import { registerMirachatWorkers } from './mirachat-worker.js'
import { waitForMirachatWorkerProbe } from './mirachat-worker-ready.js'

const memoryRuntime = createInMemoryRuntime()
const port = Number(process.env.PORT ?? 4000)
const databaseUrl = process.env.DATABASE_URL

let mirachat: MirachatSqlContext | null = null

if (databaseUrl) {
  const pool = new pg.Pool({ connectionString: databaseUrl })
  const boss = createBoss(databaseUrl) as PgBoss
  const mirachatIdentity = new PostgresIdentityService(pool)
  const mirachatMemory = new PostgresMemoryService(pool)
  await runMigrations(pool)
  await startMirachatBoss(boss)
  await registerMirachatWorkers(boss, pool, mirachatIdentity, mirachatMemory)
  await waitForMirachatWorkerProbe(boss)
  mirachat = { pool, boss, mirachatIdentity, mirachatMemory }
  console.log('MiraChat: PostgreSQL + pg-boss worker online')
}

const server = createServer(
  createDelegateApiListener({
    memoryRuntime,
    mirachat,
    mirachatWorkerReady: Boolean(mirachat),
  }),
)

server.listen(port, () => {
  console.log(`delegate-ai api listening on http://localhost:${port}`)
})
