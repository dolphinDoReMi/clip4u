import pg from 'pg'

const duplicateDbCode = '42P04'
const insufficientPrivilegeCode = '42501'

/**
 * Ensures the database named in `connectionString` exists on the same server.
 * Connects via the maintenance DB (default `postgres`), then `CREATE DATABASE` if missing.
 */
export async function ensureDatabaseExists(
  connectionString: string,
  maintenanceDatabase = process.env.POSTGRES_MAINTENANCE_DATABASE?.trim() || 'postgres',
): Promise<void> {
  let url: URL
  try {
    url = new URL(connectionString)
  } catch {
    throw new Error('DATABASE_URL is not a valid URL')
  }

  const pathPart = url.pathname.replace(/^\//, '')
  if (!pathPart) {
    throw new Error(
      'DATABASE_URL must include a database name in the path (e.g. postgresql://host:5432/mirachat)',
    )
  }

  const dbName = decodeURIComponent(pathPart)
  url.pathname = `/${encodeURIComponent(maintenanceDatabase)}`

  const adminUrl = url.toString()
  const admin = new pg.Client({ connectionString: adminUrl })
  await admin.connect()
  try {
    const found = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName])
    if (found.rowCount && found.rowCount > 0) {
      return
    }
    const ident = `"${dbName.replace(/"/g, '""')}"`
    await admin.query(`CREATE DATABASE ${ident}`)
    console.log(`created database ${dbName}`)
  } catch (e: unknown) {
    const err = e as { code?: string }
    if (err.code === duplicateDbCode) {
      return
    }
    if (err.code === insufficientPrivilegeCode) {
      throw new Error(
        `Cannot create database "${dbName}": missing privilege (CREATEDB or superuser). ` +
          `Create the database manually, or set POSTGRES_MAINTENANCE_DATABASE if your admin DB is not "postgres".`,
        { cause: e },
      )
    }
    throw e
  } finally {
    await admin.end()
  }
}
