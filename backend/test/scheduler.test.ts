import { default_w, forgetting_curve } from 'ts-fsrs'
import { describe, expect, it } from 'vitest'
import type { Block } from '../../shared/lessons'
import { createApp } from '../src/app'
import { all, get, openDb } from '../src/db/connection'
import { USER } from '../src/services/events'
import { createLesson } from '../src/services/lessons'
import { recordAttempt, startSession } from '../src/services/practice'
import { activeWeights } from '../src/services/scheduler'
import { firstReviewPairs, fitInitialStability, fitSchedulerParams, resetSchedulerParams, type FirstReviewPair } from '../src/services/schedulerFit'
import { createTopic } from '../src/services/topics'

const DAY = 86_400_000

describe('personal scheduler parameters', () => {
  it('recovers the stability that produced the outcomes, pulled slightly towards the default', () => {
    // 1000 "Good" first answers reviewed after 1..20 days, recalled as often as S = 10 predicts.
    const pairs: FirstReviewPair[] = []
    for (let k = 0; k < 1000; k++) {
      const days = 1 + (k % 20)
      const p = forgetting_curve(default_w, days, 10)
      pairs.push({ rating: 3, days, recalled: (k * 7919) % 1000 < p * 1000 })
    }
    const fit = fitInitialStability(pairs)
    expect(fit.pairs).toEqual({ 1: 0, 2: 0, 3: 1000, 4: 0 })
    expect(fit.w[2]).toBeGreaterThan(8)
    expect(fit.w[2]).toBeLessThan(12)
    expect(fit.w[0]).toBeCloseTo(default_w[0], 3) // no evidence: unchanged
    expect(fit.w[3]).toBeGreaterThanOrEqual(fit.w[2]) // monotone
    expect(fit.w.slice(4)).toEqual(default_w.slice(4).map((x) => Math.round(x * 10000) / 10000))
  })

  it('fits from attempts, replays every schedule, and can go back to the defaults', async () => {
    const db = openDb(':memory:')
    const topicId = createTopic(db, USER, { title: 'T' }).id
    const blocks: Block[] = [
      { type: 'concept', id: 'c', title: 'C', body_markdown: 'Text', callout: null },
      ...Array.from({ length: 12 }, (_, i): Block => ({ type: 'quiz_true_false', id: `q${i}`, statement: `S${i}`, answer: true, pitfall_note: 'P' })),
      { type: 'project_prompt', id: 'p', description: 'D', success_criteria: ['x'] },
    ]
    const { versionId } = createLesson(db, { topicId, title: 'L', origin: 'ai', blocks, createdBy: 'ai' })
    const items = all<{ id: string }>(db, "SELECT id FROM review_items WHERE block_id LIKE 'q%'")
    const start = Date.now() - 40 * DAY
    const session = startSession(db, 'lesson', versionId)
    for (const [i, item] of items.entries()) {
      recordAttempt(db, { session_id: session, review_item_id: item.id, answer: { value: true } }, new Date(start))
      recordAttempt(db, { session_id: session, review_item_id: item.id, answer: { value: true } }, new Date(start + (5 + i) * DAY))
    }
    expect(firstReviewPairs(db)).toHaveLength(12)

    const app = createApp(db, { aiAvailable: () => false })
    expect((await app.request('/api/scheduler/fit', { method: 'POST' })).status).toBe(409) // under 300 reviews
    const before = get<{ due_at: string }>(db, 'SELECT due_at FROM review_item_state WHERE review_item_id = ?', items[0].id)!.due_at
    const view = fitSchedulerParams(db, { minReviews: 10 })
    expect(view.personal?.trained_on_attempts).toBe(24)
    expect(view.initialStability[2]).toBeGreaterThan(default_w[2]) // always recalled after 5+ days: memories last longer
    expect(activeWeights(db)[2]).toBe(view.initialStability[2])
    expect(get(db, 'SELECT count(*) AS n FROM review_item_state')).toEqual({ n: 12 })
    expect(get<{ due_at: string }>(db, 'SELECT due_at FROM review_item_state WHERE review_item_id = ?', items[0].id)!.due_at).not.toBe(before)

    expect(resetSchedulerParams(db).personal).toBeNull()
    expect(activeWeights(db)).toEqual([...default_w])
    expect(get<{ due_at: string }>(db, 'SELECT due_at FROM review_item_state WHERE review_item_id = ?', items[0].id)!.due_at).toBe(before)
  })
})
