import { config } from '../src/config'
import { openDb } from '../src/db/connection'
import { seedIfEmpty } from '../src/db/seed'

const db = openDb(config.dbPath)
console.log(seedIfEmpty(db) ? 'Seeded the starter areas and topics.' : 'Database already has data; nothing seeded.')
