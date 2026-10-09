import { describe, expect, it } from 'vitest'
import type { Block } from '../../shared/lessons'
import { get, openDb, type Db } from '../src/db/connection'
import { createArea } from '../src/services/areas'
import { USER } from '../src/services/events'
import { createLesson, getLessonView } from '../src/services/lessons'
import { createLink, linkProblem } from '../src/services/links'
import { rankNextUp } from '../src/services/nextUp'
import { recordAttempt, startSession } from '../src/services/practice'
import { measureTopics } from '../src/services/status'
import { createTopic, getTopic, getTopicDetail, setStatus, updateTopic } from '../src/services/topics'

const fresh = (): Db => openDb(':memory:')
const topic = (db: Db, title: string, area_id: string | null = null) => createTopic(db, USER, { title, area_id }).id
const partOf = (db: Db, child: string, parent: string) =>
  createLink(db, { from_topic_id: child, to_topic_id: parent, link_type: 'part_of' })

describe('topic hierarchy', () => {
  it('allows area › topic › sub-topic and nothing deeper', () => {
    const db = fresh()
    const [dbt, bq, macros, other] = ['dbt', 'dbt on BigQuery', 'Macros', 'Other'].map((t) => topic(db, t))
    partOf(db, bq, dbt)
    expect(linkProblem(db, macros, bq, 'part_of')).toMatch(/itself a sub-topic/)
    expect(linkProblem(db, dbt, other, 'part_of')).toMatch(/has sub-topics of its own/)
    expect(linkProblem(db, bq, other, 'part_of')).toMatch(/only one parent/)
    expect(linkProblem(db, dbt, bq, 'part_of')).not.toBeNull() // would be a loop
    expect(linkProblem(db, macros, other, 'part_of', [], [[other, dbt]])).toMatch(/itself a sub-topic/)
  })

  it('keeps sub-topics in their parent area', () => {
    const db = fresh()
    const de = createArea(db, { name: 'Data engineering' }).id
    const ml = createArea(db, { name: 'Machine learning' }).id
    const dbt = topic(db, 'dbt', de)
    const child = topic(db, 'dbt testing', ml)
    partOf(db, child, dbt)
    expect(getTopic(db, child)!.area_id).toBe(de)
    expect(() => updateTopic(db, USER, child, { area_id: ml })).toThrow(/sub-topic of "dbt"/)
    updateTopic(db, USER, dbt, { area_id: ml })
    expect(getTopic(db, child)!.area_id).toBe(ml)
    expect(getTopicDetail(db, child).events.filter((e) => e.event_type === 'area_changed')).toHaveLength(2)
  })

  it('orders sub-topics by their prerequisites and marks the next one', () => {
    const db = fresh()
    const dbt = topic(db, 'dbt')
    const [a, b, c] = ['A fundamentals', 'B testing', 'C production'].map((t) => topic(db, t))
    for (const t of [a, b, c]) partOf(db, t, dbt)
    createLink(db, { from_topic_id: c, to_topic_id: a, link_type: 'prerequisite_of' })
    const path = getTopicDetail(db, dbt).subtopics
    expect(path.map((s) => s.title)).toEqual(['B testing', 'C production', 'A fundamentals'])
    expect(path.find((s) => s.next)?.title).toBe('B testing')
    expect(path[2].prereqs).toEqual(['C production'])
    setStatus(db, USER, b, 'solid')
    expect(getTopicDetail(db, dbt).subtopics.find((s) => s.next)?.title).toBe('C production')
    expect(getTopicDetail(db, a).parent?.title).toBe('dbt')
  })

  it('combines sub-topic lessons into the parent measurement, and Next up skips parents', () => {
    const db = fresh()
    const dbt = topic(db, 'dbt')
    const child = topic(db, 'dbt testing')
    partOf(db, child, dbt)
    const blocks: Block[] = [
      { type: 'concept', id: 'c', title: 'C', body_markdown: 'Text', callout: null },
      { type: 'quiz_true_false', id: 'q', statement: 'S', answer: true, pitfall_note: 'P' },
      { type: 'project_prompt', id: 'p', description: 'D', success_criteria: ['x'] },
    ]
    const { lessonId, versionId } = createLesson(db, { topicId: child, title: 'L', origin: 'ai', blocks, createdBy: 'ai' })
    expect(measureTopics(db, [dbt]).get(dbt)).toMatchObject({ mastery: 0, coverage: 0 })
    const item = get<{ id: string }>(db, 'SELECT id FROM review_items WHERE block_id = ?', 'q')!.id
    recordAttempt(db, { session_id: startSession(db, 'lesson', versionId), review_item_id: item, answer: { value: true } })
    expect(measureTopics(db, [dbt]).get(dbt)!.coverage).toBe(1)
    expect(getLessonView(db, lessonId).measurement.coverage).toBe(1)
    expect(rankNextUp(db).map((i) => i.title)).not.toContain('dbt')
  })
})
