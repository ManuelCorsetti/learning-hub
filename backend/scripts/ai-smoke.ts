// Runs Capture against the sample brain-dump in a throwaway in-memory database
// and prints the proposals it would create. Build step 4 of docs/phase-1-plan.md.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runCapture } from '../src/ai/capture'
import { config } from '../src/config'
import { all, openDb } from '../src/db/connection'
import { seedIfEmpty } from '../src/db/seed'
import { listPendingGroups } from '../src/services/proposals'

const db = openDb(':memory:')
seedIfEmpty(db)
const text = readFileSync(join(config.seedDir, 'sample-brain-dump.txt'), 'utf8')
console.log(`Model: ${config.model}\n`)
const result = await runCapture(db, text)
for (const group of listPendingGroups(db)) {
  for (const p of group.proposals) console.log(`- ${p.description}${p.rationale ? `\n    ${p.rationale}` : ''}`)
}
console.log(`\nSkipped: ${result.skipped.map((s) => `${s.title} (${s.reason})`).join('; ') || 'none'}`)
const [runRow] = all<{ attempt_count: number; input_tokens: number; output_tokens: number; latency_ms: number }>(
  db,
  'SELECT attempt_count, input_tokens, output_tokens, latency_ms FROM ai_runs',
)
console.log(
  `Attempts: ${runRow.attempt_count}, tokens in/out: ${runRow.input_tokens}/${runRow.output_tokens}, ${runRow.latency_ms} ms`,
)
