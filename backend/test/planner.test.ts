import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { describe, expect, it } from 'vitest'
import type { Block } from '../../shared/lessons'
import { checkPlanTurn, PlanTurn } from '../src/ai/lessonPlanner'
import { topicContext } from '../src/ai/lessons'
import { createApp } from '../src/app'
import { openDb, run } from '../src/db/connection'
import { USER } from '../src/services/events'
import { appendMessages, createLessonRequest, markBuilt } from '../src/services/lessonRequests'
import { createLesson } from '../src/services/lessons'
import { createLink } from '../src/services/links'
import { createTopic, getTopicDetail } from '../src/services/topics'

const plan = { title: 'CDC into BigQuery', summary: 'S', outline: ['A', 'B', 'C'], examples: 'Datastream' }

describe('lesson planner', () => {
  it('has a valid structured-output schema and a consistent ready flag', () => {
    expect(() => betaZodOutputFormat(PlanTurn)).not.toThrow()
    expect(checkPlanTurn({ reply: 'r', questions: ['q'], ready: true, plan })).toHaveLength(1)
    expect(checkPlanTurn({ reply: 'r', questions: [], ready: false, plan })).toHaveLength(1)
    expect(checkPlanTurn({ reply: 'r', questions: [], ready: true, plan })).toEqual([])
  })

  it('gives the planner and writer the lessons already taught in the topic, its parent and prerequisites', () => {
    const db = openDb(':memory:')
    const [cdc, basics, logs] = ['CDC', 'Replication basics', 'Log-based CDC'].map((title) => createTopic(db, USER, { title }).id)
    createLink(db, { from_topic_id: logs, to_topic_id: cdc, link_type: 'part_of' })
    createLink(db, { from_topic_id: basics, to_topic_id: logs, link_type: 'prerequisite_of' })
    const blocks: Block[] = [{ type: 'concept', id: 'c', title: 'Write-ahead logs', body_markdown: 'Text', callout: null }]
    const { lessonId } = createLesson(db, { topicId: basics, title: 'Replication 101', origin: 'ai', blocks, createdBy: 'ai' })
    const request = createLessonRequest(db, basics, { level: 'fundamentals', brief: 'Basics please' })
    markBuilt(db, request.id, lessonId)

    const ctx = topicContext(db, logs)
    expect(ctx.parent_topic).toBe('CDC')
    expect(ctx.existing_lessons).toEqual([
      { topic: 'Replication basics', title: 'Replication 101', level: 'fundamentals', brief: 'Basics please', covers: ['Write-ahead logs'] },
    ])
    expect(getTopicDetail(db, basics).lessons[0]).toMatchObject({ level: 'fundamentals', brief: 'Basics please' })
  })

  it('keeps the conversation and latest plan on the request', async () => {
    const db = openDb(':memory:')
    const topic = createTopic(db, USER, { title: 'CDC' }).id
    const app = createApp(db, { aiAvailable: () => false })
    const res = await app.request(`/api/topics/${topic}/lesson-requests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ level: 'applied', brief: 'Datastream into BigQuery' }),
    })
    expect(res.status).toBe(201)
    const request = await res.json()
    expect(request).toMatchObject({ level: 'applied', status: 'open', messages: [], plan: null })

    appendMessages(db, request.id, [{ role: 'assistant', reply: 'Which source?', questions: ['Postgres or MySQL?'], ready: false }], plan)
    const next = appendMessages(db, request.id, [{ role: 'user', content: 'Postgres' }])
    expect(next.messages).toHaveLength(2)
    expect(next.plan?.title).toBe('CDC into BigQuery')

    const reply = await app.request(`/api/lesson-requests/${request.id}/reply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'just build it' }),
    })
    expect(reply.status).toBe(503)
    run(db, "UPDATE lesson_requests SET status = 'built' WHERE id = ?", request.id)
    const build = await createApp(db, { aiAvailable: () => true }).request(`/api/lesson-requests/${request.id}/build`, { method: 'POST' })
    expect(build.status).toBe(409)
  })
})
