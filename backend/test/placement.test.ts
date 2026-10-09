import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { describe, expect, it } from 'vitest'
import { checkPlacement, placementBlocks, PlacementOutput } from '../src/ai/placement'
import { get, openDb } from '../src/db/connection'
import { USER } from '../src/services/events'
import { createLesson, getLessonView } from '../src/services/lessons'
import { recordAttempt, startSession } from '../src/services/practice'
import { measureTopics } from '../src/services/status'
import { createTopic } from '../src/services/topics'

const tf = (n: number) => ({ type: 'quiz_true_false' as const, id: null, statement: `S${n}`, answer: true, pitfall_note: 'P' })

describe('placement tests', () => {
  it('needs 5 to 12 questions and no project', () => {
    const out = { scope: 'Covers the basics.', questions: [1, 2, 3, 4, 5].map(tf) }
    expect(checkPlacement(out)).toEqual([])
    expect(checkPlacement({ ...out, questions: [tf(1)] }).join()).toMatch(/5 to 12/)
    expect(() => betaZodOutputFormat(PlacementOutput)).not.toThrow()
  })

  it('is a lesson whose answers measure the topic, in a placement session', () => {
    const db = openDb(':memory:')
    const topicId = createTopic(db, USER, { title: 'SQL joins' }).id
    const blocks = placementBlocks({ scope: 'Covers joins.', questions: [1, 2, 3, 4, 5].map(tf) })
    const { lessonId, versionId } = createLesson(db, { topicId, title: 'Placement test: SQL joins', origin: 'placement', blocks, createdBy: 'ai' })
    expect(() => createLesson(db, { topicId, title: 'x', origin: 'ai', blocks, createdBy: 'ai' })).toThrow(/project_prompt/)

    const session = startSession(db, 'placement', versionId)
    const view = getLessonView(db, lessonId)
    for (const item of Object.values(view.items)) {
      recordAttempt(db, { session_id: session, review_item_id: item.review_item_id, answer: { value: true }, confidence: 3 })
    }
    expect(get(db, 'SELECT kind FROM study_sessions WHERE id = ?', session)).toEqual({ kind: 'placement' })
    const m = measureTopics(db, [topicId]).get(topicId)!
    expect(m.coverage).toBe(1)
    expect(m.derived).toBe('solid') // certain and right on every question: straight to review
  })
})
