import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Block } from '../../shared/lessons'
import { createApp } from '../src/app'
import { get, openDb, type Db } from '../src/db/connection'
import { createArea } from '../src/services/areas'
import { USER } from '../src/services/events'
import { createLesson } from '../src/services/lessons'
import { recordAttempt, startSession } from '../src/services/practice'
import { createTopic } from '../src/services/topics'

const callStructured = vi.fn()
vi.mock('../src/ai/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/ai/client')>()),
  callStructured: (...args: unknown[]) => callStructured(...args),
}))
const { askAboutSelection, askContext } = await import('../src/ai/ask')

const blocks: Block[] = [
  { type: 'concept', id: 'c1', title: 'Grain', body_markdown: 'One row per sale.', callout: null },
  { type: 'quiz_true_false', id: 'q1', statement: 'Grain is optional.', answer: false, pitfall_note: 'Always declare it.' },
  { type: 'project_prompt', id: 'p1', description: 'Build', success_criteria: ['One'] },
]

describe('asking about a selection', () => {
  let db: Db
  let topicId: string
  let lessonId: string
  let versionId: string

  beforeEach(() => {
    callStructured.mockReset()
    db = openDb(':memory:')
    const areaId = createArea(db, { name: 'Data' }).id
    topicId = createTopic(db, USER, { title: 'Fact tables', area_id: areaId }).id
    ;({ lessonId, versionId } = createLesson(db, { topicId, title: 'Grain', origin: 'ai', blocks, createdBy: 'ai' }))
  })

  it('sends the lesson, the block and whether its question is answered yet', () => {
    const before = askContext(db, { lesson_id: lessonId, block_id: 'q1' })
    expect(before).toMatchObject({
      page: 'lesson',
      topic: { title: 'Fact tables', area: 'Data' },
      lesson: { title: 'Grain', blocks },
      selected_from_block: { id: 'q1', type: 'quiz_true_false', already_answered: false },
    })
    expect(before).not.toHaveProperty('diagram_keys')

    const item = get<{ id: string }>(db, "SELECT id FROM review_items WHERE block_id = 'q1'")!.id
    recordAttempt(db, { session_id: startSession(db, 'lesson', versionId), review_item_id: item, answer: { value: false } })
    expect(askContext(db, { lesson_id: lessonId, block_id: 'q1' })).toMatchObject({ selected_from_block: { already_answered: true } })
    expect(askContext(db, { lesson_id: lessonId, block_id: 'c1' })).toMatchObject({ selected_from_block: { id: 'c1', type: 'concept' } })
  })

  it('falls back to the topic, then the area, then nothing', () => {
    expect(askContext(db, { topic_id: topicId })).toMatchObject({ page: 'topic', topic: { title: 'Fact tables' } })
    const areaId = get<{ id: string }>(db, 'SELECT id FROM areas')!.id
    expect(askContext(db, { area_id: areaId })).toMatchObject({ page: 'area', area: { name: 'Data', topics: [{ title: 'Fact tables' }] } })
    expect(askContext(db, {})).toEqual({ page: 'other' })
  })

  it('returns the answer and follow-ups without writing anything else', async () => {
    callStructured.mockResolvedValue({ runId: 'run-1', result: { answer: 'The **grain** is…', follow_ups: ['How do I pick it?'] } })
    const out = await askAboutSelection(db, {
      selection: 'One row per sale.',
      question: 'What does this mean?',
      context: { lesson_id: lessonId, block_id: 'c1' },
      history: [],
    })
    expect(out).toEqual({ answer: 'The **grain** is…', follow_ups: ['How do I pick it?'], run_id: 'run-1' })
    const call = callStructured.mock.calls[0][1]
    expect(call).toMatchObject({ task: 'ask', promptName: 'ask', input: { selection: 'One row per sale.', question: 'What does this mean?' } })
    expect(get<{ n: number }>(db, 'SELECT count(*) AS n FROM proposals')!.n).toBe(0)
  })

  it('needs AI and a selection', async () => {
    const off = createApp(db, { aiAvailable: () => false })
    const post = (app: ReturnType<typeof createApp>, body: object) =>
      app.request('/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    expect((await post(off, { selection: 'x', question: 'y', context: {} })).status).toBe(503)
    const on = createApp(db, { aiAvailable: () => true })
    expect((await post(on, { selection: '  ', question: 'y', context: {} })).status).toBe(400)
  })
})
