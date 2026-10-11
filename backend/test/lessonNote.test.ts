import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Block } from '../../shared/lessons'
import { all, openDb, type Db } from '../src/db/connection'
import { USER } from '../src/services/events'
import { createLesson } from '../src/services/lessons'
import { createTopic } from '../src/services/topics'
import { newId } from '../src/lib'

const callStructured = vi.fn()
vi.mock('../src/ai/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/ai/client')>()),
  callStructured: (...args: unknown[]) => callStructured(...args),
}))
const { sendLessonMessage } = await import('../src/ai/lessonEditor')

/** What callStructured does on success: log the run, return its id and the result. */
function claudeReplies(db: Db, result: object) {
  callStructured.mockImplementation(async () => {
    const runId = newId()
    db.prepare(
      `INSERT INTO ai_runs (id, task, prompt_name, prompt_hash, model, request_json, attempts_json, outcome, attempt_count, created_at)
       VALUES (?, 'lesson_patch', 'test', 'x', 'test', '{}', '[]', 'ok', 1, ?)`,
    ).run(runId, new Date().toISOString())
    return { runId, result }
  })
}

const blocks: Block[] = [
  { type: 'concept', id: 'c1', title: 'Config', body_markdown: 'Text', callout: null },
  { type: 'code_challenge', id: 'q1', language: 'yaml', question: 'Which file?', snippet: 's', expected_answer: 'profiles.yml', acceptable_answers: [], hint: 'h' },
  { type: 'project_prompt', id: 'p1', description: 'Build', success_criteria: ['One'] },
]

describe('a note on a lesson', () => {
  let db: Db
  let lessonId: string
  const proposals = () => all<{ kind: string; payload_json: string }>(db, "SELECT kind, payload_json FROM proposals WHERE kind = 'lesson_patch'")

  beforeEach(() => {
    callStructured.mockReset()
    db = openDb(':memory:')
    const topicId = createTopic(db, USER, { title: 'dbt' }).id
    lessonId = createLesson(db, { topicId, title: 'L', origin: 'ai', blocks, createdBy: 'ai' }).lessonId
  })

  it('makes no proposal when Claude returns an empty block list', async () => {
    claudeReplies(db, { reply: 'It was marked on meaning.', change_note: '', blocks_json: '[]' })
    const thread = await sendLessonMessage(db, lessonId, { message: 'why?', block_id: 'q1' })
    expect(proposals()).toEqual([])
    expect(thread.map((m) => m.role)).toEqual(['user', 'assistant'])
  })

  it('turns an edited block list into one proposal, and gives Claude the answers to the block', async () => {
    const edited = [
      { type: 'keep', id: 'c1' },
      { ...blocks[1], acceptable_answers: ['profiles.yaml'] },
      { type: 'keep', id: 'p1' },
    ]
    claudeReplies(db, { reply: 'Added the .yaml spelling.', change_note: 'Accept .yaml', blocks_json: JSON.stringify(edited) })
    await sendLessonMessage(db, lessonId, { message: 'my answer should count', block_id: 'q1' })
    const [row] = proposals()
    expect(JSON.parse(row.payload_json).ops).toEqual([expect.objectContaining({ op: 'replace', block_id: 'q1' })])
    expect(callStructured.mock.calls[0][1].input).toHaveProperty('my_recent_answers_to_that_block', [])
  })
})
