import { describe, expect, it } from 'vitest'
import { openDb, run, type Db } from '../src/db/connection'
import { seedIfEmpty } from '../src/db/seed'
import { createArea } from '../src/services/areas'
import { USER } from '../src/services/events'
import { addResource } from '../src/services/goals'
import { createLink, linkProblem } from '../src/services/links'
import { getHome } from '../src/services/map'
import { rankNextUp } from '../src/services/nextUp'
import { measure } from '../src/services/status'
import {
  archiveTopic,
  createTopic,
  getTopicDetail,
  mergeTopics,
  resolveOverrides,
  restoreTopic,
  setStatus,
} from '../src/services/topics'

const fresh = (): Db => openDb(':memory:')
const topic = (db: Db, title: string, area_id: string | null = null) => createTopic(db, USER, { title, area_id }).id

describe('measure', () => {
  const base = { itemCount: 10, attemptedCount: 10, retention: 0.9, allInReview: true, reviewsDue: 0 }

  it('is not measured when there is nothing to test', () => {
    expect(measure({ ...base, itemCount: 0 })).toMatchObject({ mastery: null, derived: 'backlog' })
  })
  it('is backlog until the first attempt', () => {
    expect(measure({ ...base, attemptedCount: 0, retention: null }).derived).toBe('backlog')
  })
  it('is solid at 80% mastery with every item tested and in review', () => {
    expect(measure({ ...base, retention: 0.8 }).derived).toBe('solid')
    expect(measure({ ...base, retention: 0.79 }).derived).toBe('learning')
  })
  it('is learning while coverage is incomplete, however good the retention', () => {
    const m = measure({ ...base, attemptedCount: 9, retention: 1 })
    expect(m.mastery).toBeCloseTo(0.9)
    expect(m.derived).toBe('learning')
  })
  it('is learning while items are still in the learning steps', () => {
    expect(measure({ ...base, allInReview: false }).derived).toBe('learning')
  })
})

describe('status overrides', () => {
  it('sets an override and clears it when the measured status is chosen', () => {
    const db = fresh()
    const id = topic(db, 'Rust ownership')
    setStatus(db, USER, id, 'learning', 'Starting this week')
    let detail = getTopicDetail(db, id)
    expect(detail.status).toMatchObject({ effective: 'learning', derived: 'backlog', override: 'learning', mastery: null })

    setStatus(db, USER, id, 'backlog')
    detail = getTopicDetail(db, id)
    expect(detail.status).toMatchObject({ effective: 'backlog', override: null })
    expect(detail.events.map((e) => e.event_type)).toEqual(['status_override_cleared', 'status_override_set', 'created'])
  })

  it('auto-resolves an override once measurement equals it', () => {
    const db = fresh()
    const id = topic(db, 'Go basics')
    // Simulate an override that measurement has caught up with (derived is backlog in Phase 1).
    run(db, "UPDATE topics SET status_override = 'backlog', status_override_at = '2026-01-01T00:00:00.000Z' WHERE id = ?", id)
    expect(resolveOverrides(db)).toEqual([id])
    const detail = getTopicDetail(db, id)
    expect(detail.status.override).toBeNull()
    expect(detail.events[0]).toMatchObject({ event_type: 'status_override_resolved', actor: 'system' })
  })
})

describe('topics', () => {
  it('rejects a second live topic with the same title, ignoring case', () => {
    const db = fresh()
    topic(db, 'dbt macros')
    expect(() => topic(db, 'DBT Macros')).toThrow(/already exists/)
  })

  it('archives and restores, keeping history', () => {
    const db = fresh()
    const id = topic(db, 'Typer')
    archiveTopic(db, USER, id)
    expect(() => setStatus(db, USER, id, 'learning')).toThrow(/archived/)
    restoreTopic(db, USER, id)
    expect(getTopicDetail(db, id).events.map((e) => e.event_type)).toEqual(['restored', 'archived', 'created'])
  })

  it('merges links and resources into the kept topic and drops the self-link', () => {
    const db = fresh()
    const keep = topic(db, 'Dimensional modelling')
    const dup = topic(db, 'Kimball')
    const other = topic(db, 'Data Vault')
    createLink(db, { from_topic_id: dup, to_topic_id: keep, link_type: 'related_to' })
    createLink(db, { from_topic_id: dup, to_topic_id: other, link_type: 'prerequisite_of' })
    addResource(db, dup, { kind: 'book', title: 'The Data Warehouse Toolkit', note: 'Kimball & Ross' })

    mergeTopics(db, USER, keep, dup)

    const kept = getTopicDetail(db, keep)
    expect(kept.links).toHaveLength(1)
    expect(kept.links[0]).toMatchObject({ link_type: 'prerequisite_of', direction: 'out', other: { title: 'Data Vault' } })
    expect(kept.resources.map((r) => r.title)).toEqual(['The Data Warehouse Toolkit'])
    const merged = getTopicDetail(db, dup)
    expect(merged.merged_into_id).toBe(keep)
    expect(merged.archived_at).not.toBeNull()
  })
})

describe('links', () => {
  it('blocks prerequisite loops, including through proposed links', () => {
    const db = fresh()
    const [a, b, c] = ['Closures', 'Decorators', 'Context managers'].map((t) => topic(db, t))
    createLink(db, { from_topic_id: a, to_topic_id: b, link_type: 'prerequisite_of' })
    expect(linkProblem(db, b, a, 'prerequisite_of')).toMatch(/loop/)
    expect(linkProblem(db, c, a, 'prerequisite_of', [[b, c]])).toMatch(/loop/)
    expect(linkProblem(db, c, a, 'prerequisite_of')).toBeNull()
  })

  it('stores related_to once regardless of direction', () => {
    const db = fresh()
    const [a, b] = ['Go', 'Rust'].map((t) => topic(db, t))
    createLink(db, { from_topic_id: b, to_topic_id: a, link_type: 'related_to' })
    expect(linkProblem(db, a, b, 'related_to')).toMatch(/already exists/)
  })

  it('allows only one part_of parent', () => {
    const db = fresh()
    const [child, p1, p2] = ['dbt incremental models', 'dbt', 'Materialisation'].map((t) => topic(db, t))
    createLink(db, { from_topic_id: child, to_topic_id: p1, link_type: 'part_of' })
    expect(linkProblem(db, child, p2, 'part_of')).toMatch(/only one parent/)
  })
})

describe('next up', () => {
  it('ranks unblocked, high-leverage topics first and explains without AI', () => {
    const db = fresh()
    const area = createArea(db, { name: 'Data engineering' }).id
    const [mat, inc, macros, tests] = ['Materialisation strategies', 'dbt incremental models', 'dbt macros', 'dbt testing'].map(
      (t) => topic(db, t, area),
    )
    createLink(db, { from_topic_id: mat, to_topic_id: inc, link_type: 'prerequisite_of' })
    createLink(db, { from_topic_id: inc, to_topic_id: macros, link_type: 'prerequisite_of' })
    createLink(db, { from_topic_id: inc, to_topic_id: tests, link_type: 'prerequisite_of' })

    const ranked = rankNextUp(db)
    expect(ranked[0].title).toBe('Materialisation strategies')
    expect(ranked[0].factors.unlocks).toHaveLength(3)
    expect(ranked[0].fallbackWhy).toMatch(/^Unlocks/)
    const blocked = ranked.find((r) => r.title === 'dbt macros')!
    expect(blocked.factors.unmetPrereqs).toEqual(['dbt incremental models'])
    expect(blocked.fallbackWhy).toMatch(/Needs dbt incremental models first/)

    setStatus(db, USER, mat, 'solid', 'Already use these daily')
    expect(rankNextUp(db).map((r) => r.title)).not.toContain('Materialisation strategies')
    expect(rankNextUp(db)[0].title).toBe('dbt incremental models')
  })
})

describe('seed and home', () => {
  it('loads the starter map once', () => {
    const db = fresh()
    expect(seedIfEmpty(db)).toBe(true)
    expect(seedIfEmpty(db)).toBe(false)
    const home = getHome(db, false)
    expect(home.areas.map((a) => [a.name, a.topicCount])).toEqual([
      ['Data engineering', 2],
      ['Machine learning', 1],
      ['Cloud & platform', 1],
    ])
    expect(home.areas[0].counts).toEqual({ backlog: 2, learning: 0, solid: 0 })
    expect(home.topicCount).toBe(4)
  })
})
