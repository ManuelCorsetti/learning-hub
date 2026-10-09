// Status is measured, not typed in. See docs/data-model.md → "How status works".
import { SOLID_MASTERY_THRESHOLD, type ReviewState, type TopicStatus } from '../../../shared/domain'
import type { Measurement, TopicStatusInfo } from '../../../shared/api'
import { all, type Db } from '../db/connection'
import { retrievability } from './scheduler'

export interface MeasurementInput {
  /** Scheduled, live review items for the topic. */
  itemCount: number
  /** Items with at least one attempt. */
  attemptedCount: number
  /** Mean current recall probability over attempted items (0–1). */
  retention: number | null
  /** True when every scheduled item is in the scheduler's `review` state. */
  allInReview: boolean
  reviewsDue: number
}

/** Pure rule: coverage × retention → mastery → derived status. */
export function measure(input: MeasurementInput): Measurement {
  if (input.itemCount === 0) {
    return { mastery: null, coverage: null, retention: null, derived: 'backlog', reviewsDue: 0 }
  }
  const coverage = input.attemptedCount / input.itemCount
  const retention = input.retention ?? 0
  const mastery = coverage * retention
  let derived: TopicStatus = 'learning'
  if (input.attemptedCount === 0) derived = 'backlog'
  else if (mastery >= SOLID_MASTERY_THRESHOLD && coverage === 1 && input.allInReview) derived = 'solid'
  return { mastery, coverage, retention: input.retention, derived, reviewsDue: input.reviewsDue }
}

/**
 * Measures topics from the scheduled, live review items of their live lessons. A parent
 * topic's figure combines its own lessons with its sub-topics' lessons.
 * Retention uses the scheduler's recall probability at `now`, so mastery decays without review.
 */
export function measureTopics(db: Db, topicIds: string[], now = new Date()): Map<string, Measurement> {
  const inputs = new Map<string, MeasurementInput>()
  const retention = new Map<string, number[]>()
  for (const id of topicIds) {
    inputs.set(id, { itemCount: 0, attemptedCount: 0, retention: null, allInReview: true, reviewsDue: 0 })
    retention.set(id, [])
  }
  if (topicIds.length) {
    // A parent's measurement combines its own lessons with those of its live sub-topics.
    const rows = all<{
      topic_id: string
      parent_id: string | null
      state: ReviewState | null
      stability: number | null
      last_reviewed_at: string | null
      due_at: string | null
    }>(
      db,
      `SELECT l.topic_id, p.id AS parent_id, s.state, s.stability, s.last_reviewed_at, s.due_at
       FROM review_items ri
       JOIN lessons l ON l.id = ri.lesson_id AND l.archived_at IS NULL
       LEFT JOIN topic_links pl ON pl.from_topic_id = l.topic_id AND pl.link_type = 'part_of'
       LEFT JOIN topics p ON p.id = pl.to_topic_id AND p.archived_at IS NULL
       LEFT JOIN review_item_state s ON s.review_item_id = ri.id
       WHERE ri.is_scheduled = 1 AND ri.retired_at IS NULL
         AND (l.topic_id IN (SELECT value FROM json_each(?))
           OR (p.id IN (SELECT value FROM json_each(?))
             AND l.topic_id IN (SELECT id FROM topics WHERE archived_at IS NULL)))`,
      JSON.stringify(topicIds),
      JSON.stringify(topicIds),
    )
    const nowIso = now.toISOString()
    for (const r of rows) {
      for (const id of [r.topic_id, r.parent_id]) {
        const input = id ? inputs.get(id) : undefined
        if (!input) continue
        input.itemCount++
        if (r.state !== 'review') input.allInReview = false
        if (r.state === null) continue
        input.attemptedCount++
        retention.get(id!)!.push(retrievability(r, now))
        if (r.due_at! <= nowIso) input.reviewsDue++
      }
    }
  }
  const result = new Map<string, Measurement>()
  for (const [id, input] of inputs) {
    const values = retention.get(id)!
    input.retention = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
    result.set(id, measure(input))
  }
  return result
}

export function statusInfo(
  override: TopicStatus | null,
  overrideNote: string | null,
  measurement: Measurement,
): TopicStatusInfo {
  return {
    effective: override ?? measurement.derived,
    derived: measurement.derived,
    override,
    overrideNote,
    mastery: measurement.mastery,
    reviewsDue: measurement.reviewsDue,
  }
}
