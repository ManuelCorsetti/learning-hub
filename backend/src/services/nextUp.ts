// Next up: deterministic ranking. Claude only writes the short "why" for the top items.
import type { NextUpItem } from '../../../shared/api'
import { all, get, run, type Db } from '../db/connection'
import { newId, nowIso, sha256 } from '../lib'
import { prerequisiteEdges } from './links'
import { listTopics } from './topics'

export const NEXT_UP_EXPLAINED = 3

const WEIGHTS = { prereqReady: 40, perUnlock: 8, maxUnlocks: 5, goal: 25, learning: 15, reviewsDue: 20 }

export function rankNextUp(db: Db, limit = 6): NextUpItem[] {
  const topics = listTopics(db)
  const byId = new Map(topics.map((t) => [t.id, t]))
  const areaNames = new Map(
    all<{ id: string; name: string }>(db, 'SELECT id, name FROM areas').map((a) => [a.id, a.name]),
  )
  const edges = prerequisiteEdges(db)
  const prereqsOf = new Map<string, string[]>()
  const dependantsOf = new Map<string, string[]>()
  for (const [from, to] of edges) {
    prereqsOf.set(to, [...(prereqsOf.get(to) ?? []), from])
    dependantsOf.set(from, [...(dependantsOf.get(from) ?? []), to])
  }
  const goalRows = all<{ topic_id: string; title: string }>(
    db,
    `SELECT tg.topic_id, g.title FROM topic_goals tg JOIN goals g ON g.id = tg.goal_id WHERE g.status = 'active'`,
  )

  const isSolid = (id: string) => byId.get(id)?.status.effective === 'solid'

  /** Every topic this one eventually unlocks, excluding those already solid. */
  const unlocks = (id: string): string[] => {
    const seen = new Set<string>()
    const stack = [...(dependantsOf.get(id) ?? [])]
    while (stack.length) {
      const next = stack.pop()!
      if (seen.has(next)) continue
      seen.add(next)
      stack.push(...(dependantsOf.get(next) ?? []))
    }
    return [...seen].filter((d) => byId.has(d) && !isSolid(d))
  }

  const items = topics
    // Solid topics drop out of Next up until their reviews come due.
    .filter((t) => t.status.effective !== 'solid' || t.status.reviewsDue > 0)
    .map<NextUpItem>((t) => {
      const prereqs = (prereqsOf.get(t.id) ?? []).filter((p) => byId.has(p))
      const unmet = prereqs.filter((p) => !isSolid(p))
      const prereqReady = prereqs.length ? (prereqs.length - unmet.length) / prereqs.length : 1
      const unlocked = unlocks(t.id)
      const goals = goalRows.filter((g) => g.topic_id === t.id).map((g) => g.title)
      const learning = t.status.effective === 'learning'
      const reviewsDue = t.status.reviewsDue
      const score =
        WEIGHTS.prereqReady * prereqReady +
        WEIGHTS.perUnlock * Math.min(unlocked.length, WEIGHTS.maxUnlocks) +
        (goals.length ? WEIGHTS.goal : 0) +
        (learning ? WEIGHTS.learning : 0) +
        (reviewsDue ? WEIGHTS.reviewsDue : 0)
      const factors = {
        prereqs: prereqs.map((p) => byId.get(p)!.title),
        prereqReady,
        unmetPrereqs: unmet.map((p) => byId.get(p)!.title),
        unlocks: unlocked.map((d) => byId.get(d)!.title),
        goals,
        learning,
        reviewsDue,
      }
      return {
        topic_id: t.id,
        title: t.title,
        area_id: t.area_id,
        areaName: t.area_id ? (areaNames.get(t.area_id) ?? null) : null,
        score: Math.round(score),
        factors,
        why: null,
        fallbackWhy: fallbackWhy(factors),
      }
    })
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, limit)

  for (const item of items.slice(0, NEXT_UP_EXPLAINED)) item.why = cachedWhy(db, item)
  return items
}

function list(names: string[], max = 2): string {
  const shown = names.slice(0, max)
  const rest = names.length - shown.length
  return shown.join(' and ') + (rest > 0 ? ` (+${rest} more)` : '')
}

export function fallbackWhy(f: NextUpItem['factors']): string {
  const parts: string[] = []
  if (f.reviewsDue) parts.push(`${f.reviewsDue} review${f.reviewsDue === 1 ? '' : 's'} due.`)
  if (f.learning) parts.push('Already in progress.')
  if (f.unlocks.length) parts.push(`Unlocks ${list(f.unlocks)}.`)
  if (f.goals.length) parts.push(`Serves your goal "${f.goals[0]}".`)
  if (f.unmetPrereqs.length) parts.push(`Needs ${list(f.unmetPrereqs)} first.`)
  else if (!parts.length) parts.push('Nothing blocks it.')
  return parts.join(' ')
}

/** The facts a "why" is written from. The text is reused until these change. */
export function whyInputHash(item: NextUpItem): string {
  return sha256(JSON.stringify({ title: item.title, area: item.areaName, factors: item.factors }))
}

function cachedWhy(db: Db, item: NextUpItem): string | null {
  return (
    get<{ text: string }>(
      db,
      `SELECT text FROM ai_text_cache WHERE purpose = 'next_up_why' AND subject_id = ? AND input_hash = ?`,
      item.topic_id,
      whyInputHash(item),
    )?.text ?? null
  )
}

export function storeWhy(db: Db, item: NextUpItem, text: string, aiRunId: string): void {
  run(
    db,
    `INSERT OR REPLACE INTO ai_text_cache (id, purpose, subject_id, input_hash, text, ai_run_id, created_at)
     VALUES (?, 'next_up_why', ?, ?, ?, ?, ?)`,
    newId(),
    item.topic_id,
    whyInputHash(item),
    text,
    aiRunId,
    nowIso(),
  )
}
