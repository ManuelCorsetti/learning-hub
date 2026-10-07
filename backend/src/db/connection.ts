import { mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'

export type Db = DatabaseSync
type Param = SQLInputValue | boolean | undefined

const here = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = join(here, 'migrations')

/** Opens the database with the settings every connection needs, and applies pending migrations. */
export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec('PRAGMA foreign_keys = ON') // OFF by default in SQLite
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA busy_timeout = 5000')
  migrate(db)
  return db
}

export function migrate(db: Db): string[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`)
  const applied = new Set(all<{ name: string }>(db, 'SELECT name FROM schema_migrations').map((r) => r.name))
  const pending = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql') && !applied.has(f))
    .sort()
  for (const file of pending) {
    tx(db, () => {
      db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'))
      run(db, 'INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)', file, new Date().toISOString())
    })
  }
  return pending
}

function bind(params: Param[]): SQLInputValue[] {
  return params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p))
}

export function all<T>(db: Db, sql: string, ...params: Param[]): T[] {
  return db.prepare(sql).all(...bind(params)) as T[]
}

export function get<T>(db: Db, sql: string, ...params: Param[]): T | undefined {
  return db.prepare(sql).get(...bind(params)) as T | undefined
}

export function run(db: Db, sql: string, ...params: Param[]): number {
  return Number(db.prepare(sql).run(...bind(params)).changes)
}

const depth = new WeakMap<Db, number>()

/** Runs fn in a transaction (or a savepoint when nested). fn must be synchronous. */
export function tx<T>(db: Db, fn: () => T): T {
  const level = depth.get(db) ?? 0
  const savepoint = `sp_${level}`
  db.exec(level === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${savepoint}`)
  depth.set(db, level + 1)
  try {
    const result = fn()
    db.exec(level === 0 ? 'COMMIT' : `RELEASE ${savepoint}`)
    return result
  } catch (err) {
    db.exec(level === 0 ? 'ROLLBACK' : `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`)
    throw err
  } finally {
    depth.set(db, level)
  }
}
