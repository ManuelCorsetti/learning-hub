// Personal scheduler parameters. Fits FSRS's initial stabilities (w0–w3: how long a memory
// lasts after the first answer, per rating) from your own history, the same "pretrain" step
// the FSRS optimizer starts with. The other weights keep their defaults. Fitting is explicit,
// and replaying attempts rebuilds every schedule with the new parameters.
import { default_w, forgetting_curve } from 'ts-fsrs'
import type { SchedulerView } from '../../../shared/api'
import type { Rating } from '../../../shared/domain'
import { all, get, run, tx, type Db } from '../db/connection'
import { AppError, newId, nowIso } from '../lib'
import { activeWeights, rebuildSchedules } from './scheduler'

/** Rated reviews needed before fitting is offered ("several hundred"). */
export const MIN_REVIEWS = 300
/** First-answer → next-review pairs needed for one rating's stability to move from the default. */
const MIN_PAIRS = 10
/** Pull towards the default: a rating with n pairs gets weight n / (n + PRIOR) on its own fit. */
const PRIOR = 20
const DAY_MS = 86_400_000

export interface FirstReviewPair {
  rating: Rating
  days: number
  recalled: boolean
}

/** The first rated answer of each item, paired with its next rated answer at least a day later. */
export function firstReviewPairs(db: Db): FirstReviewPair[] {
  const rows = all<{ review_item_id: string; rating: Rating; at: string }>(
    db,
    'SELECT review_item_id, rating, answered_at AS at FROM attempts WHERE rating IS NOT NULL ORDER BY review_item_id, answered_at, id',
  )
  const pairs: FirstReviewPair[] = []
  let i = 0
  while (i < rows.length) {
    const item = rows[i].review_item_id
    const first = rows[i]
    let j = i + 1
    while (j < rows.length && rows[j].review_item_id === item) {
      const days = (new Date(rows[j].at).getTime() - new Date(first.at).getTime()) / DAY_MS
      if (days >= 1) {
        pairs.push({ rating: first.rating, days, recalled: rows[j].rating > 1 })
        break
      }
      j++
    }
    while (i < rows.length && rows[i].review_item_id === item) i++
  }
  return pairs
}

/** Maximum-likelihood stability for one rating's pairs, by golden-section search on log(S). */
function fitStability(pairs: FirstReviewPair[], w: readonly number[]): number {
  const logLikelihood = (logS: number) => {
    const s = Math.exp(logS)
    return pairs.reduce((sum, p) => {
      const r = Math.min(Math.max(forgetting_curve(w, p.days, s), 1e-6), 1 - 1e-6)
      return sum + (p.recalled ? Math.log(r) : Math.log(1 - r))
    }, 0)
  }
  let lo = Math.log(0.1)
  let hi = Math.log(365)
  const g = (Math.sqrt(5) - 1) / 2
  for (let k = 0; k < 80; k++) {
    const a = hi - g * (hi - lo)
    const b = lo + g * (hi - lo)
    if (logLikelihood(a) < logLikelihood(b)) lo = a
    else hi = b
  }
  return Math.exp((lo + hi) / 2)
}

/** New weights with w0–w3 fitted where there is enough evidence, pulled towards the defaults. */
export function fitInitialStability(pairs: FirstReviewPair[], base: readonly number[] = default_w): { w: number[]; pairs: Record<Rating, number> } {
  const w = [...base]
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0 } as Record<Rating, number>
  for (const rating of [1, 2, 3, 4] as Rating[]) {
    const own = pairs.filter((p) => p.rating === rating)
    counts[rating] = own.length
    if (own.length < MIN_PAIRS) continue
    const fitted = fitStability(own, base)
    const weight = own.length / (own.length + PRIOR)
    w[rating - 1] = Math.exp(weight * Math.log(fitted) + (1 - weight) * Math.log(base[rating - 1]))
  }
  // A more confident first answer never means a shorter-lived memory.
  for (let k = 1; k < 4; k++) w[k] = Math.max(w[k], w[k - 1])
  return { w: w.map((x) => Math.round(x * 10000) / 10000), pairs: counts }
}

const ratedReviews = (db: Db) => get<{ n: number }>(db, 'SELECT count(*) AS n FROM attempts WHERE rating IS NOT NULL')!.n

export function schedulerView(db: Db): SchedulerView {
  const active = get<{ id: string; params_json: string; trained_on_attempts: number; created_at: string }>(
    db,
    "SELECT id, params_json, trained_on_attempts, created_at FROM scheduler_params WHERE scheduler = 'fsrs' AND is_active = 1",
  )
  return {
    ratedReviews: ratedReviews(db),
    minReviews: MIN_REVIEWS,
    initialStability: activeWeights(db).slice(0, 4),
    defaultInitialStability: default_w.slice(0, 4),
    personal: active
      ? { id: active.id, trained_on_attempts: active.trained_on_attempts, created_at: active.created_at }
      : null,
  }
}

/** Fits, activates and replays. Refuses until there is enough history. */
export function fitSchedulerParams(db: Db, options: { minReviews?: number } = {}): SchedulerView {
  const n = ratedReviews(db)
  const min = options.minReviews ?? MIN_REVIEWS
  if (n < min) throw new AppError(`Fitting needs at least ${min} rated reviews; you have ${n}.`, 409)
  const fit = fitInitialStability(firstReviewPairs(db))
  tx(db, () => {
    run(db, "UPDATE scheduler_params SET is_active = 0 WHERE scheduler = 'fsrs' AND is_active = 1")
    run(
      db,
      `INSERT INTO scheduler_params (id, scheduler, params_json, trained_on_attempts, is_active, created_at)
       VALUES (?, 'fsrs', ?, ?, 1, ?)`,
      newId(),
      JSON.stringify({ method: 'initial_stability', w: fit.w, pairs: fit.pairs }),
      n,
      nowIso(),
    )
    rebuildSchedules(db)
  })
  return schedulerView(db)
}

/** Back to the library defaults. Earlier fits stay in scheduler_params, inactive. */
export function resetSchedulerParams(db: Db): SchedulerView {
  tx(db, () => {
    run(db, "UPDATE scheduler_params SET is_active = 0 WHERE scheduler = 'fsrs' AND is_active = 1")
    rebuildSchedules(db)
  })
  return schedulerView(db)
}
