import { readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Pool } from 'pg'

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../migrations')

export const runMigrations = async (pool: Pool): Promise<void> => {
  const client = await pool.connect()
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `)
    const applied = new Set(
      (await client.query<{ id: string }>('SELECT id FROM schema_migrations')).rows.map((r: { id: string }) => r.id),
    )
    const files = (await readdir(migrationsDir))
      .filter(f => f.endsWith('.sql'))
      .sort()
    for (const file of files) {
      const id = file
      if (applied.has(id)) {
        continue
      }
      const sql = await readFile(join(migrationsDir, file), 'utf8')
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [id])
        await client.query('COMMIT')
      } catch (e) {
        await client.query('ROLLBACK')
        throw e
      }
    }
  } finally {
    client.release()
  }
}
