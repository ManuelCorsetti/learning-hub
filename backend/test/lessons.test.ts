import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { describe, expect, it } from 'vitest'
import type { LessonView } from '../../shared/api'
import { GeneratedLesson, GeneratedQuestions, lessonProblems, type Block, type InteractiveBlock } from '../../shared/lessons'
import { checkGeneratedLesson, checkGeneratedQuestions, mergeQuestions } from '../src/ai/lessons'
import { createApp } from '../src/app'
import { all, get, openDb, run, type Db } from '../src/db/connection'
import { seedIfEmpty } from '../src/db/seed'
import { articleToBlocks, importSeedArticles } from '../src/services/articles'
import { USER } from '../src/services/events'
import { grade, normaliseCode, rate } from '../src/services/grading'
import { addVersion, assignIds, createLesson, getLessonView, latestVersion } from '../src/services/lessons'
import { practiceQueue, recordAttempt, reviewsDue, startSession } from '../src/services/practice'
import { rebuildSchedules, refreshSchedule } from '../src/services/scheduler'
import { measureTopics } from '../src/services/status'
import { createTopic, getTopicDetail, mergeTopics, resolveOverrides, setStatus } from '../src/services/topics'

const fresh = (): Db => openDb(':memory:')
const DAY = 86_400_000

const concept = (id: string): Block => ({ type: 'concept', id, title: `About ${id}`, body_markdown: 'Text', callout: null })
const mcq = (id: string, correct = 1): Block => ({
  type: 'quiz_mcq',
  id,
  question: 'Which?',
  options: ['a', 'b', 'c', 'd'],
  correct_index: correct,
  pitfall_note: 'Because b.',
})
const tf = (id: string, answer = true): Block => ({ type: 'quiz_true_false', id, statement: 'It is so.', answer, pitfall_note: 'Note' })
const project = (id = 'project'): Block => ({ type: 'project_prompt', id, description: 'Build it', success_criteria: ['One', 'Two'] })

function lessonFor(db: Db, blocks: Block[] = [concept('c1'), mcq('q1'), tf('q2'), project()]) {
  const topicId = createTopic(db, USER, { title: `Topic ${Math.random()}` }).id
  const { lessonId, versionId } = createLesson(db, { topicId, title: 'Lesson', origin: 'ai', blocks, createdBy: 'ai' })
  return { topicId, lessonId, versionId }
}

const itemId = (db: Db, lessonId: string, blockId: string) =>
  get<{ id: string }>(db, 'SELECT id FROM review_items WHERE lesson_id = ? AND block_id = ?', lessonId, blockId)!.id

/** Answers every scheduled item of a lesson, at `at`, right or wrong. */
function answerAll(db: Db, lessonId: string, versionId: string, at: Date, right = true, confidence: 1 | 2 | 3 = 2) {
  const session = startSession(db, 'lesson', versionId)
  for (const b of getLessonView(db, lessonId).blocks) {
    const answer =
      b.type === 'quiz_mcq' ? { choice: right ? b.correct_index : (b.correct_index + 1) % 4 }
      : b.type === 'quiz_true_false' ? { value: right ? b.answer : !b.answer }
      : null
    if (!answer) continue
    recordAttempt(db, { session_id: session, review_item_id: itemId(db, lessonId, b.id), answer, confidence }, at)
  }
}

describe('lesson rules', () => {
  it('accepts a teaching-only lesson and a complete one', () => {
    expect(lessonProblems([concept('a')])).toEqual([])
    expect(lessonProblems([concept('a'), mcq('q'), project()])).toEqual([])
  })
  it('needs exactly one project prompt, last, once there are questions', () => {
    expect(lessonProblems([concept('a'), mcq('q')]).join()).toMatch(/exactly one project_prompt/)
    expect(lessonProblems([concept('a'), project(), mcq('q')]).join()).toMatch(/must be the last/)
  })
  it('puts a teaching block before any question and keeps ids unique', () => {
    const problems = lessonProblems([mcq('q'), concept('q'), project()]).join()
    expect(problems).toMatch(/after at least one teaching block/)
    expect(problems).toMatch(/used twice/)
  })
  it('checks ordering items and fill-in-blank gaps', () => {
    const ordering = (shuffled: string[]): Block => ({
      type: 'ordering',
      id: 'o',
      prompt: 'Order',
      items_shuffled: shuffled,
      correct_order: ['a', 'b', 'c'],
    })
    expect(lessonProblems([concept('c'), ordering(['a', 'b', 'c']), project()]).join()).toMatch(/already in the correct order/)
    expect(lessonProblems([concept('c'), ordering(['a', 'b', 'x']), project()]).join()).toMatch(/permutation/)
    expect(lessonProblems([concept('c'), ordering(['c', 'a', 'b']), project()])).toEqual([])
    const fill: Block = { type: 'fill_in_blank', id: 'f', sentence: 'No gap here', acceptable_answers: ['x'] }
    expect(lessonProblems([concept('c'), fill, project()]).join()).toMatch(/exactly one ___/)
  })
  it('builds structured-output schemas for both generation modes', () => {
    expect(() => betaZodOutputFormat(GeneratedLesson)).not.toThrow()
    expect(() => betaZodOutputFormat(GeneratedQuestions)).not.toThrow()
  })
  it('assigns ids the AI left out', () => {
    const blocks = assignIds([{ ...concept('c'), id: null }, { ...mcq('q'), id: null }, { ...mcq('q'), id: 'kept' }])
    expect(blocks[2].id).toBe('kept')
    expect(blocks[1].id).toMatch(/^quiz_mcq-[0-9a-f]{8}$/)
    expect(new Set(blocks.map((b) => b.id)).size).toBe(3)
  })
  it('rejects a generated lesson without questions', () => {
    expect(checkGeneratedLesson({ title: 'x', blocks: [{ ...concept('c'), id: null }] }).join()).toMatch(/no questions/)
  })
})

describe('imported article', () => {
  it('maps sections to concept, steps and diagram blocks', () => {
    const blocks = articleToBlocks({
      id: 'a',
      title: 'A',
      sections: [
        { id: 's1', title: 'One', body: 'Body', callout: 'Spark', visual: 'star' },
        { id: 's2', title: 'Two', body: 'Intro', steps: [{ title: 'x', text: 'y' }, { title: 'z', text: 'w' }] },
      ],
    })
    expect(blocks.map((b) => `${b.type}:${b.id}`)).toEqual(['concept:s1', 'diagram:s1-diagram', 'steps:s2'])
    expect(blocks[0]).toMatchObject({ callout: 'Spark' })
  })
  it('imports dimensional modelling once, as a teaching-only v1', () => {
    const db = fresh()
    seedIfEmpty(db)
    expect(importSeedArticles(db)).toEqual(['Dimensional modelling'])
    expect(importSeedArticles(db)).toEqual([])
    const lesson = get<{ id: string; origin: string }>(db, 'SELECT id, origin FROM lessons')!
    const view = getLessonView(db, lesson.id)
    expect(view).toMatchObject({ origin: 'imported_article', version: { version_no: 1, created_by: 'user' } })
    expect(view.blocks.filter((b) => b.type === 'diagram')).toHaveLength(5)
    expect(view.measurement.mastery).toBeNull()
  })
  it('places generated questions after their teaching blocks and the project last', () => {
    const teaching = [concept('a'), concept('b')]
    const out = {
      questions: [
        { after_block_id: 'b', block: { ...tf('x'), id: null } },
        { after_block_id: 'a', block: { ...mcq('y'), id: null } },
      ],
      project_prompt: { ...project(), id: null },
    } as never
    expect(mergeQuestions(teaching, out).map((b) => b.type)).toEqual([
      'concept',
      'quiz_mcq',
      'concept',
      'quiz_true_false',
      'project_prompt',
    ])
    expect(checkGeneratedQuestions(out, teaching)).toEqual([])
    const bad = { ...(out as object), questions: [{ after_block_id: 'nope', block: { ...tf('x'), id: null } }] } as never
    expect(checkGeneratedQuestions(bad, teaching).join()).toMatch(/not a block of this lesson/)
  })
})

describe('versions and review items', () => {
  it('creates an item per interactive block; only questions are scheduled', () => {
    const db = fresh()
    const { lessonId } = lessonFor(db)
    const items = all<{ block_id: string; is_scheduled: number }>(
      db,
      'SELECT block_id, is_scheduled FROM review_items WHERE lesson_id = ? ORDER BY block_id',
      lessonId,
    )
    expect(items).toEqual([
      { block_id: 'project', is_scheduled: 0 },
      { block_id: 'q1', is_scheduled: 1 },
      { block_id: 'q2', is_scheduled: 1 },
    ])
  })
  it('retires dropped blocks, keeps schedules for kept ids, and refuses a type change', () => {
    const db = fresh()
    const { lessonId, versionId } = lessonFor(db)
    answerAll(db, lessonId, versionId, new Date())
    addVersion(db, lessonId, { blocks: [concept('c1'), mcq('q1'), mcq('q3'), project()], createdBy: 'user' })
    const retired = all<{ block_id: string }>(db, 'SELECT block_id FROM review_items WHERE retired_at IS NOT NULL')
    expect(retired.map((r) => r.block_id)).toEqual(['q2'])
    expect(latestVersion(db, lessonId).version_no).toBe(2)
    expect(getLessonView(db, lessonId).items.q1.attempts).toBe(1)
    expect(() =>
      addVersion(db, lessonId, { blocks: [concept('c1'), tf('q1'), project()], createdBy: 'user' }),
    ).toThrow(/needs a new id/)
  })
})

describe('grading and rating', () => {
  it('grades each question type', () => {
    expect(grade(mcq('q', 2) as never, { choice: 2 })).toEqual({ is_correct: true, score: 1 })
    expect(grade(tf('q', false) as never, { value: true }).is_correct).toBe(false)
    const fill: InteractiveBlock = { type: 'fill_in_blank', id: 'f', sentence: 'A ___ b', acceptable_answers: ['Grain'] }
    expect(grade(fill, { text: '  grain ' }).is_correct).toBe(true)
    const code: InteractiveBlock = {
      type: 'code_challenge',
      id: 'c',
      language: 'sql',
      question: 'q',
      snippet: 's',
      expected_answer: 'SELECT a, b FROM t;',
      acceptable_answers: [],
      hint: 'h',
    }
    expect(grade(code, { text: 'select a,b  from t' }).is_correct).toBe(true)
    expect(normaliseCode('f( x )')).toBe('f(x)')
    const ordering: InteractiveBlock = {
      type: 'ordering',
      id: 'o',
      prompt: 'p',
      items_shuffled: ['c', 'a', 'b', 'd'],
      correct_order: ['a', 'b', 'c', 'd'],
    }
    expect(grade(ordering, { order: ['a', 'b', 'd', 'c'] })).toEqual({ is_correct: false, score: 0.5 })
    expect(grade(project() as never, { checked: [0] })).toEqual({ is_correct: null, score: 0.5 })
    expect(() => grade(mcq('q') as never, { value: true })).toThrow(/does not fit/)
  })
  it('maps results and confidence to ratings', () => {
    expect(rate({ is_correct: false, score: 0 }, 3)).toBe(1)
    expect(rate({ is_correct: false, score: 0.4 }, 2)).toBe(1)
    expect(rate({ is_correct: false, score: 0.5 }, 2)).toBe(2)
    expect(rate({ is_correct: true, score: 1 }, 1)).toBe(2)
    expect(rate({ is_correct: true, score: 1 }, 2)).toBe(3)
    expect(rate({ is_correct: true, score: 1 }, null)).toBe(3)
    expect(rate({ is_correct: true, score: 1 }, 3)).toBe(4)
    expect(rate({ is_correct: null, score: 1 }, 3)).toBeNull()
  })
})

describe('attempts, scheduling and mastery', () => {
  it('is backlog before attempts and learning after the first ones', () => {
    const db = fresh()
    const { topicId, lessonId, versionId } = lessonFor(db)
    expect(measureTopics(db, [topicId]).get(topicId)).toMatchObject({ mastery: 0, coverage: 0, derived: 'backlog' })
    answerAll(db, lessonId, versionId, new Date())
    const m = measureTopics(db, [topicId]).get(topicId)!
    expect(m.coverage).toBe(1)
    expect(m.mastery).toBeGreaterThan(0.9)
    expect(m.derived).toBe('learning') // still in the short-term learning steps
  })
  it('records confidently wrong answers and does not schedule the project', () => {
    const db = fresh()
    const { lessonId, versionId } = lessonFor(db)
    const session = startSession(db, 'lesson', versionId)
    const wrong = recordAttempt(db, { session_id: session, review_item_id: itemId(db, lessonId, 'q1'), answer: { choice: 0 }, confidence: 3 })
    expect(wrong).toMatchObject({ is_correct: false, rating: 1, confidently_wrong: true, state: 'learning' })
    const proj = recordAttempt(db, { session_id: session, review_item_id: itemId(db, lessonId, 'project'), answer: { checked: [0, 1] } })
    expect(proj).toMatchObject({ is_correct: null, rating: null, due_at: null })
    expect(get(db, 'SELECT 1 FROM review_item_state WHERE review_item_id = ?', itemId(db, lessonId, 'project'))).toBeUndefined()
  })
  it('becomes solid after spaced correct reviews, then decays and shows reviews due', () => {
    const db = fresh()
    const { topicId, lessonId, versionId } = lessonFor(db)
    const start = Date.now() - 90 * DAY
    answerAll(db, lessonId, versionId, new Date(start))
    answerAll(db, lessonId, versionId, new Date(start + 15 * 60_000))
    answerAll(db, lessonId, versionId, new Date(start + 3 * DAY))
    const atReview = new Date(start + 3 * DAY + 60_000)
    expect(measureTopics(db, [topicId], atReview).get(topicId)!.derived).toBe('solid')
    const later = measureTopics(db, [topicId]).get(topicId)!
    expect(later.reviewsDue).toBe(2)
    expect(later.mastery!).toBeLessThan(0.8)
    expect(later.derived).toBe('learning')
    expect(reviewsDue(db)).toBe(2)
    expect(practiceQueue(db).due.map((d) => d.block.id).sort()).toEqual(['q1', 'q2'])
  })
  it('lists nothing in Practice until an item is due', () => {
    const db = fresh()
    const { lessonId, versionId } = lessonFor(db)
    answerAll(db, lessonId, versionId, new Date(), true, 3)
    const queue = practiceQueue(db, new Date(Date.now() - 60_000))
    expect(queue.due).toEqual([])
    expect(queue.nextDueAt).not.toBeNull()
  })
  it('clears an override once measurement catches up', () => {
    const db = fresh()
    const { topicId, lessonId, versionId } = lessonFor(db)
    setStatus(db, USER, topicId, 'learning')
    answerAll(db, lessonId, versionId, new Date())
    const detail = getTopicDetail(db, topicId)
    expect(detail.status).toMatchObject({ override: null, effective: 'learning', derived: 'learning' })
    expect(detail.events.some((e) => e.event_type === 'status_override_resolved')).toBe(true)
    expect(resolveOverrides(db)).toEqual([])
  })
  it('rebuilds the same schedule from attempts', () => {
    const db = fresh()
    const { lessonId, versionId } = lessonFor(db)
    answerAll(db, lessonId, versionId, new Date(Date.now() - DAY))
    answerAll(db, lessonId, versionId, new Date())
    const before = all(db, 'SELECT review_item_id, state, stability, difficulty, due_at, reps FROM review_item_state ORDER BY 1')
    run(db, `UPDATE review_item_state SET stability = 999`)
    expect(rebuildSchedules(db)).toBe(2)
    expect(all(db, 'SELECT review_item_id, state, stability, difficulty, due_at, reps FROM review_item_state ORDER BY 1')).toEqual(before)
    expect(refreshSchedule(db, itemId(db, lessonId, 'project'))).toBeNull()
  })
  it('moves lessons when topics merge', () => {
    const db = fresh()
    const { topicId, lessonId } = lessonFor(db)
    const keep = createTopic(db, USER, { title: 'Keeper' }).id
    mergeTopics(db, USER, keep, topicId)
    expect(getTopicDetail(db, keep).lessons.map((l) => l.id)).toEqual([lessonId])
  })
})

describe('lesson API', () => {
  it('serves a lesson and records attempts', async () => {
    const db = fresh()
    const { lessonId } = lessonFor(db)
    const app = createApp(db, { aiAvailable: () => false })
    const lesson = (await (await app.request(`/api/lessons/${lessonId}`)).json()) as LessonView
    expect(lesson.items.q1.attempts).toBe(0)

    const session = await app.request('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ kind: 'lesson', lesson_version_id: lesson.version.id }),
    })
    const { id } = (await session.json()) as { id: string }
    const attempt = await app.request('/api/attempts', {
      method: 'POST',
      body: JSON.stringify({ session_id: id, review_item_id: lesson.items.q1.review_item_id, answer: { choice: 1 }, confidence: 3 }),
    })
    expect(attempt.status).toBe(201)
    expect(await attempt.json()).toMatchObject({ is_correct: true, rating: 4 })

    const bad = await app.request('/api/attempts', {
      method: 'POST',
      body: JSON.stringify({ session_id: id, review_item_id: lesson.items.q1.review_item_id, answer: { choice: 1 }, confidence: 7 }),
    })
    expect(bad.status).toBe(400)
    const build = await app.request(`/api/topics/${lesson.topic.id}/lessons`, { method: 'POST' })
    expect(build.status).toBe(503)
  })
})
