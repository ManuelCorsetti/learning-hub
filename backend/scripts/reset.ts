// Deletes the local database and recreates it with the starter seed.
import { rmSync } from 'node:fs'
import { config } from '../src/config'
import { openDb } from '../src/db/connection'
import { seedIfEmpty } from '../src/db/seed'

for (const suffix of ['', '-wal', '-shm']) rmSync(config.dbPath + suffix, { force: true })
const db = openDb(config.dbPath)
seedIfEmpty(db)
console.log(`Reset ${config.dbPath} with the starter seed.`)
