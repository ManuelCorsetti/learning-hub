// Prints recent Claude calls from ai_runs. `npm run ai:runs` lists them; `npm run ai:runs -- <run id>` shows one in full.
import { config } from '../src/config'
import { openDb } from '../src/db/connection'
import { getAiRun, listAiRuns } from '../src/services/aiRuns'

const db = openDb(config.dbPath)
const id = process.argv[2]
if (id) console.log(JSON.stringify(getAiRun(db, id), null, 2))
else {
  for (const r of listAiRuns(db, 20)) {
    console.log(`${r.created_at}  ${r.task.padEnd(16)} ${r.outcome.padEnd(7)} ${r.model}  ${r.id}${r.error ? `\n    ${r.error}` : ''}`)
  }
}
