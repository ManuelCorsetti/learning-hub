// The one AI call pattern (docs/phase-1-plan.md, rule 3):
// prompt → JSON → schema validation → on failure retry once with the errors appended
// → on a second failure return a clear error. Never guess or silently repair.
// Every call, successful or not, is logged in ai_runs.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { z } from 'zod'
import type { AiTask } from '../../../shared/domain'
import { config } from '../config'
import { run, type Db } from '../db/connection'
import { AppError, newId, nowIso, sha256 } from '../lib'
import { currentModel, profileText } from '../services/settings'

const MAX_ATTEMPTS = 2

let client: Anthropic | null = null
const getClient = () => (client ??= new Anthropic())

/** True when a credential is configured. (The SDK can also use an `ant auth login` profile.) */
export const aiConfigured = (): boolean =>
  Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE)

export function loadPrompt(name: string): { text: string; hash: string } {
  const text = readFileSync(join(config.promptsDir, `${name}.txt`), 'utf8')
  return { text, hash: sha256(text) }
}

interface AttemptLog {
  raw_output: string | null
  stop_reason: string | null
  validation_errors: string[]
}

export interface StructuredCall<T> {
  task: AiTask
  promptName: string
  schema: z.ZodType<T>
  input: unknown
  /** Checks that need the database, e.g. "every id refers to a real topic". */
  check?: (output: T) => string[]
  effort?: 'low' | 'medium' | 'high'
}

export class AiError extends AppError {
  constructor(
    message: string,
    readonly runId: string,
  ) {
    super(message, 502)
  }
}

export async function callStructured<T>(db: Db, call: StructuredCall<T>): Promise<{ runId: string; result: T }> {
  const runId = newId()
  const prompt = loadPrompt(call.promptName)
  const effort = call.effort ?? 'medium'
  const model = currentModel(db)
  const profile = profileText(db)
  // The learner profile travels with every call as a second system block, after the task prompt.
  const system: Anthropic.Beta.BetaTextBlockParam[] = [{ type: 'text', text: prompt.text }]
  if (profile) {
    system.push({
      type: 'text',
      text: `The person you are helping wrote this profile. Use it to tailor examples, depth and vocabulary. Do not repeat it back.\n\n${profile}`,
    })
  }
  const started = Date.now()
  const attempts: AttemptLog[] = []
  let inputTokens = 0
  let outputTokens = 0

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: 'user', content: `Input:\n\`\`\`json\n${JSON.stringify(call.input, null, 2)}\n\`\`\`` },
  ]

  const log = (outcome: 'ok' | 'invalid' | 'error', result: T | null) => {
    // One line per call in the server terminal; the full record is in ai_runs (Settings → Recent Claude calls).
    const seconds = ((Date.now() - started) / 1000).toFixed(1)
    const problem = outcome === 'ok' ? '' : ` · ${attempts.at(-1)?.validation_errors.join('; ').slice(0, 300) ?? ''}`
    const line = `[ai] ${call.task} · ${model} · ${outcome} · ${attempts.length} attempt(s) · ${inputTokens}/${outputTokens} tokens · ${seconds}s · run ${runId}${problem}`
    if (outcome === 'ok') console.log(line)
    else console.error(line)
    return run(
      db,
      `INSERT INTO ai_runs (id, task, prompt_name, prompt_hash, model, request_json, attempts_json, result_json,
         outcome, attempt_count, input_tokens, output_tokens, latency_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      runId,
      call.task,
      call.promptName,
      prompt.hash,
      model,
      JSON.stringify({ effort, profile, input: call.input }),
      JSON.stringify(attempts),
      result === null ? null : JSON.stringify(result),
      outcome,
      Math.max(attempts.length, 1),
      inputTokens,
      outputTokens,
      Date.now() - started,
      nowIso(),
    )
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let response: Anthropic.Beta.BetaMessage
    try {
      response = await getClient().beta.messages.create({
        model,
        max_tokens: 16000,
        system,
        messages,
        output_config: { effort, format: betaZodOutputFormat(call.schema) },
        // If a safety classifier declines, retry server-side on Anthropic's recommended fallback model.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      })
    } catch (err) {
      attempts.push({ raw_output: null, stop_reason: null, validation_errors: [describeApiError(err)] })
      log('error', null)
      throw new AiError(`Claude request failed: ${describeApiError(err)}`, runId)
    }
    inputTokens += response.usage.input_tokens
    outputTokens += response.usage.output_tokens

    const raw = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')

    if (response.stop_reason === 'refusal') {
      attempts.push({ raw_output: raw, stop_reason: 'refusal', validation_errors: ['Claude declined the request'] })
      log('error', null)
      throw new AiError('Claude declined this request', runId)
    }

    const errors = validate(raw, response.stop_reason, call)
    attempts.push({ raw_output: raw, stop_reason: response.stop_reason, validation_errors: errors.problems })
    if (!errors.problems.length) {
      log('ok', errors.value!)
      return { runId, result: errors.value! }
    }
    if (attempt < MAX_ATTEMPTS) {
      messages.push({ role: 'assistant', content: response.content })
      messages.push({
        role: 'user',
        content:
          'That output failed validation:\n' +
          errors.problems.map((p) => `- ${p}`).join('\n') +
          '\nReturn the complete corrected JSON.',
      })
    }
  }
  log('invalid', null)
  throw new AiError(
    `Claude's answer failed validation twice: ${attempts.at(-1)!.validation_errors.join('; ')}`,
    runId,
  )
}

function validate<T>(raw: string, stopReason: string | null, call: StructuredCall<T>): { problems: string[]; value?: T } {
  if (stopReason === 'max_tokens') return { problems: ['The answer was cut off at the token limit'] }
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return { problems: ['The answer was not valid JSON'] }
  }
  const parsed = call.schema.safeParse(json)
  if (!parsed.success) return { problems: [z.prettifyError(parsed.error)] }
  const problems = call.check?.(parsed.data) ?? []
  return problems.length ? { problems } : { problems: [], value: parsed.data }
}

function describeApiError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return 'no valid API key (set ANTHROPIC_API_KEY)'
  if (err instanceof Anthropic.RateLimitError) return 'rate limited, try again shortly'
  if (err instanceof Anthropic.APIError) return `API error ${err.status ?? ''} ${err.message}`.trim()
  return err instanceof Error ? err.message : String(err)
}
