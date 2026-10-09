// Rebuilds review_item_state by replaying every attempt through the current scheduler.
import { config } from '../src/config'
import { openDb } from '../src/db/connection'
import { rebuildSchedules, SCHEDULER_VERSION } from '../src/services/scheduler'

const db = openDb(config.dbPath)
console.log(`Rebuilt ${rebuildSchedules(db)} schedules with ${SCHEDULER_VERSION}.`)
