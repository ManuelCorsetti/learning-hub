// FSRS via ts-fsrs, desired retention 0.9. Default parameters until you fit personal ones
// (scheduler_params). review_item_state is a cache: an item's state is always the replay of
// its rated attempts, so changing parameters or upgrading the library only needs rebuildSchedules().
import { createEmptyCard, default_w, forgetting_curve, fsrs, FSRSVersion, State, type Card, type FSRS, type Grade } from 'ts-fsrs'
import { REVIEW_STATES, type Rating, type ReviewState } from '../../../shared/domain'
import { all, get, run, tx, type Db } from '../db/connection'
import { nowIso, sha256 } from '../lib'

export const DESIRED_RETENTION = 0.9

const DAY_MS = 86_400_000

export interface ReviewItemStateRow {
  review_item_id: string
  scheduler: string
  scheduler_version: string
  state: ReviewState
  stability: number | null
  difficulty: number | null
  due_at: string
  last_reviewed_at: string | null
  reps: number
  lapses: number
  computed_at: string
}

/** The active personal FSRS weights, or the library defaults. */
export function activeWeights(db: Db): number[] {
  const row = get<{ params_json: string }>(db, "SELECT params_json FROM scheduler_params WHERE scheduler = 'fsrs' AND is_active = 1")
  return row ? (JSON.parse(row.params_json) as { w: number[] }).w : [...default_w]
}

const schedulers = new Map<string, FSRS>()
function schedulerFor(w: number[]): FSRS {
  const key = JSON.stringify(w)
  if (!schedulers.has(key)) schedulers.set(key, fsrs({ request_retention: DESIRED_RETENTION, w }))
  return schedulers.get(key)!
}

export function schedulerVersion(db: Db): string {
  const parameters = schedulerFor(activeWeights(db)).parameters
  return `ts-fsrs ${FSRSVersion} params:${sha256(JSON.stringify(parameters)).slice(0, 12)}`
}

/** Replays rated reviews, oldest first, from an empty card. */
export function replay(reviews: { rating: Rating; at: string }[], w: number[] = [...default_w]): Card | null {
  if (!reviews.length) return null
  const scheduler = schedulerFor(w)
  let card = createEmptyCard(new Date(reviews[0].at))
  for (const r of reviews) card = scheduler.next(card, new Date(r.at), r.rating as Grade).card
  return card
}

/** Probability of recall at `now`. */
export function retrievability(
  state: Pick<ReviewItemStateRow, 'stability' | 'last_reviewed_at'>,
  now = new Date(),
  w: readonly number[] = default_w,
): number {
  if (!state.stability || !state.last_reviewed_at) return 0
  const elapsedDays = Math.max(0, (now.getTime() - new Date(state.last_reviewed_at).getTime()) / DAY_MS)
  return forgetting_curve(w, elapsedDays, state.stability)
}

/** Recomputes one item's schedule from its attempts. Items with no rated attempt have no state row. */
export function refreshSchedule(db: Db, reviewItemId: string): ReviewItemStateRow | null {
  const reviews = all<{ rating: Rating; at: string }>(
    db,
    `SELECT rating, answered_at AS at FROM attempts
     WHERE review_item_id = ? AND rating IS NOT NULL ORDER BY answered_at, id`,
    reviewItemId,
  )
  const card = replay(reviews, activeWeights(db))
  run(db, 'DELETE FROM review_item_state WHERE review_item_id = ?', reviewItemId)
  if (!card) return null
  const row: ReviewItemStateRow = {
    review_item_id: reviewItemId,
    scheduler: 'fsrs',
    scheduler_version: schedulerVersion(db),
    state: REVIEW_STATES[card.state as State],
    stability: card.stability,
    difficulty: card.difficulty,
    due_at: card.due.toISOString(),
    last_reviewed_at: card.last_review?.toISOString() ?? null,
    reps: card.reps,
    lapses: card.lapses,
    computed_at: nowIso(),
  }
  run(
    db,
    `INSERT INTO review_item_state (review_item_id, scheduler, scheduler_version, state, stability, difficulty,
       due_at, last_reviewed_at, reps, lapses, computed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row.review_item_id,
    row.scheduler,
    row.scheduler_version,
    row.state,
    row.stability,
    row.difficulty,
    row.due_at,
    row.last_reviewed_at,
    row.reps,
    row.lapses,
    row.computed_at,
  )
  return row
}

/** Rebuilds every schedule from attempts. Returns the number of items with a schedule. */
export function rebuildSchedules(db: Db): number {
  return tx(db, () => {
    run(db, 'DELETE FROM review_item_state')
    const ids = all<{ id: string }>(db, 'SELECT id FROM review_items WHERE is_scheduled = 1')
    return ids.filter((r) => refreshSchedule(db, r.id)).length
  })
}

/** Rebuilds only if a schedule was computed by another scheduler version. Run on start. */
export function rebuildIfStale(db: Db): boolean {
  const stale = all(db, 'SELECT 1 FROM review_item_state WHERE scheduler_version <> ? LIMIT 1', schedulerVersion(db))
  if (!stale.length) return false
  rebuildSchedules(db)
  return true
}
