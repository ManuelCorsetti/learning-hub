// Status is measured, not typed in. See docs/data-model.md → "How status works".
import { SOLID_MASTERY_THRESHOLD, type TopicStatus } from '../../../shared/domain'
import type { Measurement, TopicStatusInfo } from '../../../shared/api'
import type { Db } from '../db/connection'

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
 * Measures topics from their review items. Phase 1 has no lessons or attempts yet,
 * so every topic is "not measured" and derives to backlog. Phase 2 replaces the
 * body with an aggregate over review_items / review_item_state and keeps the signature.
 */
export function measureTopics(_db: Db, topicIds: string[]): Map<string, Measurement> {
  const result = new Map<string, Measurement>()
  for (const id of topicIds) {
    result.set(id, measure({ itemCount: 0, attemptedCount: 0, retention: null, allInReview: false, reviewsDue: 0 }))
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
  }
}
