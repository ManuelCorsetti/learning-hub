import { config } from '../src/config'
import { migrate, openDb } from '../src/db/connection'

const db = openDb(config.dbPath) // applies pending migrations on open
console.log(`Database: ${config.dbPath}`)
console.log(migrate(db).length ? 'Applied migrations.' : 'Schema is up to date.')
