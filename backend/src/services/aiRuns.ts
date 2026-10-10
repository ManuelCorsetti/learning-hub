// Read side of ai_runs: what the app asked Claude, and what came back. For seeing what happened.
import type { AiRunDetail, AiRunSummary } from '../../../shared/api'
import { all, get, type Db } from '../db/connection'
import { notFound } from '../lib'

interface RunRow {
  id: string
  task: string
  prompt_name: string
  model: string
  outcome: AiRunSummary['outcome']
  attempt_count: number
  input_tokens: number | null
  output_tokens: number | null
  latency_ms: number | null
  created_at: string
  request_json: string
  attempts_json: string
  result_json: string | null
}

const lastError = (attemptsJson: string): string | null => {
  const attempts = JSON.parse(attemptsJson) as { validation_errors: string[] }[]
  const errors = attempts.at(-1)?.validation_errors ?? []
  return errors.length ? errors.join('; ') : null
}

const summary = (r: RunRow): AiRunSummary => ({
  id: r.id,
  task: r.task,
  model: r.model,
  outcome: r.outcome,
  attempt_count: r.attempt_count,
  input_tokens: r.input_tokens,
  output_tokens: r.output_tokens,
  latency_ms: r.latency_ms,
  created_at: r.created_at,
  error: r.outcome === 'ok' ? null : lastError(r.attempts_json),
})

export function listAiRuns(db: Db, limit = 30): AiRunSummary[] {
  return all<RunRow>(db, 'SELECT * FROM ai_runs ORDER BY created_at DESC LIMIT ?', limit).map(summary)
}

export function getAiRun(db: Db, id: string): AiRunDetail {
  const row = get<RunRow>(db, 'SELECT * FROM ai_runs WHERE id = ?', id)
  if (!row) throw notFound('AI run')
  return {
    ...summary(row),
    prompt_name: row.prompt_name,
    request: JSON.parse(row.request_json),
    attempts: JSON.parse(row.attempts_json),
    result: row.result_json ? JSON.parse(row.result_json) : null,
  }
}
