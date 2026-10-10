import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { describe, expect, it } from 'vitest'
import type { Block } from '../../shared/lessons'
import { checkOptimise, hasSignals, optimiseDrafts, OptimiseOutput, optimiseSignals } from '../src/ai/optimise'
import { createApp } from '../src/app'
import { all, get, openDb, type Db } from '../src/db/connection'
import { newId } from '../src/lib'
import { createArea } from '../src/services/areas'
import { USER } from '../src/services/events'
import { createLesson } from '../src/services/lessons'
import { createLink, parentEdges } from '../src/services/links'
import { recordAttempt, startSession } from '../src/services/practice'
import { acceptRun, createProposals, listPendingGroups } from '../src/services/proposals'
import { createTopic, listTopics, setStatus } from '../src/services/topics'

const blocks: Block[] = [
  { type: 'concept', id: 'c', title: 'Wrapping', body_markdown: 'Text', callout: null },
  { type: 'quiz_true_false', id: 'q', statement: 'A decorator keeps the name', answer: false, pitfall_note: 'P' },
  { type: 'project_prompt', id: 'p', description: 'D', success_criteria: ['x'] },
]

function contextOf(db: Db) {
  const parentOf = new Map(parentEdges(db))
  return {
    areas: all<{ id: string; name: string }>(db, 'SELECT id, name FROM areas'),
    topics: listTopics(db).map((t) => ({ id: t.id, title: t.title, summary: t.summary, area_id: t.area_id, parent_topic_id: parentOf.get(t.id) ?? null, status: t.status.effective })),
    links: [],
  }
}

describe('optimise', () => {
  it('collects confidently wrong answers and contradicted overrides as signals', () => {
    const db = openDb(':memory:')
    const topic = createTopic(db, USER, { title: 'Decorators' }).id
    expect(hasSignals(optimiseSignals(db))).toBe(false)
    const { versionId } = createLesson(db, { topicId: topic, title: 'Decorators 101', origin: 'ai', blocks, createdBy: 'ai' })
    const item = get<{ id: string }>(db, "SELECT id FROM review_items WHERE block_id = 'q'")!.id
    recordAttempt(db, { session_id: startSession(db, 'lesson', versionId), review_item_id: item, answer: { value: true }, confidence: 3 })
    setStatus(db, USER, topic, 'solid')
    const signals = optimiseSignals(db)
    expect(signals.confidentlyWrong).toEqual([
      { topic: 'Decorators', lesson: 'Decorators 101', question: 'A decorator keeps the name [false]', times: 1 },
    ])
    expect(signals.contradicted).toMatchObject([{ topic: 'Decorators', you_set: 'solid', measured: 'learning' }])
    expect(hasSignals(signals)).toBe(true)
  })

  it('turns a missing prerequisite into a new topic plus a link that depends on it', () => {
    const db = openDb(':memory:')
    const area = createArea(db, { name: 'Python' }).id
    const decorators = createTopic(db, USER, { title: 'Decorators', area_id: area }).id
    const out: OptimiseOutput = {
      observations: ['Closures look shaky.'],
      new_topics: [{ title: 'Closures', summary: 's', area_id: null, parent_topic_id: null, prerequisite_of: decorators, rationale: 'r' }],
      new_links: [],
      merges: [],
    }
    const ctx = contextOf(db)
    expect(checkOptimise(db, out, ctx)).toEqual([])
    expect(checkOptimise(db, { ...out, new_topics: [{ ...out.new_topics[0], title: 'decorators' }] }, ctx).join()).toMatch(/already exists/)
    const drafts = optimiseDrafts(out, ctx)
    expect(drafts.map((d) => d.kind)).toEqual(['create_topic', 'create_link'])
    expect(drafts[1].depends_on_id).toBe(drafts[0].id)

    const runId = newId()
    db.prepare(
      `INSERT INTO ai_runs (id, task, prompt_name, prompt_hash, model, request_json, attempts_json, result_json, outcome, attempt_count, created_at)
       VALUES (?, 'optimise', 'optimise', 'x', 'test', '{}', '[]', ?, 'ok', 1, ?)`,
    ).run(runId, JSON.stringify(out), new Date().toISOString())
    createProposals(db, runId, drafts)
    expect(listPendingGroups(db)[0].observations).toEqual(['Closures look shaky.'])
    expect(acceptRun(db, runId).every((r) => r.status === 'accepted')).toBe(true)
    const closures = listTopics(db).find((t) => t.title === 'Closures')!
    expect(closures.area_id).toBe(area)
    expect(get(db, "SELECT 1 FROM topic_links WHERE from_topic_id = ? AND to_topic_id = ? AND link_type = 'prerequisite_of'", closures.id, decorators)).toBeDefined()
  })

  it('refuses loops and runs without AI only to report there is nothing to learn from', async () => {
    const db = openDb(':memory:')
    const [a, b] = ['A', 'B'].map((title) => createTopic(db, USER, { title }).id)
    createLink(db, { from_topic_id: a, to_topic_id: b, link_type: 'prerequisite_of' })
    const loop: OptimiseOutput = { observations: [], new_topics: [], new_links: [{ from_topic_id: b, to_topic_id: a, link_type: 'prerequisite_of', rationale: '' }], merges: [] }
    expect(checkOptimise(db, loop, contextOf(db)).join()).toMatch(/loop/)
    expect(() => betaZodOutputFormat(OptimiseOutput)).not.toThrow()
    const res = await createApp(db, { aiAvailable: () => true }).request('/api/optimise', { method: 'POST' })
    expect(await res.json()).toMatchObject({ runId: null, created: 0 })
  })
})
