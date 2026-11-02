import 'dotenv/config'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const { Pool } = pg
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const directory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations')

try {
  await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto')
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`)
  const files = (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort()
  for (const filename of files) {
    const alreadyApplied = await pool.query(
      'SELECT 1 FROM schema_migrations WHERE filename = $1',
      [filename],
    )
    if (alreadyApplied.rowCount) continue

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(await readFile(path.join(directory, filename), 'utf8'))
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename])
      await client.query('COMMIT')
      console.log(`Applied migration ${filename}`)
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }
} catch (error) {
  console.error('Database migration failed:', error.message)
  process.exitCode = 1
} finally {
  await pool.end()
}
