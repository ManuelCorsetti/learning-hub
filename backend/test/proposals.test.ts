import { describe, expect, it } from 'vitest'
import { captureDrafts, checkCapture, type CaptureOutput } from '../src/ai/capture'
import { checkOrganise, organiseDrafts, type OrganiseOutput } from '../src/ai/organise'
import { createApp } from '../src/app'
import { all, openDb, type Db } from '../src/db/connection'
import { newId } from '../src/lib'
import { createArea } from '../src/services/areas'
import { USER } from '../src/services/events'
import { createLink, parentEdges } from '../src/services/links'
import {
  acceptProposal,
  acceptRun,
  createProposals,
  listPendingGroups,
  pendingCountsByArea,
  rejectProposal,
} from '../src/services/proposals'
import { createTopic, getTopicDetail, listTopics } from '../src/services/topics'

const fresh = (): Db => openDb(':memory:')

/** Inserts a fake ai_runs row so proposals can be grouped by run. */
function fakeRun(db: Db, task: string): string {
  const id = newId()
  db.prepare(
    `INSERT INTO ai_runs (id, task, prompt_name, prompt_hash, model, request_json, attempts_json, outcome, attempt_count, created_at)
     VALUES (?, ?, 'test', 'x', 'test', '{}', '[]', 'ok', 1, ?)`,
  ).run(id, task, new Date().toISOString())
  return id
}

function captureContext(db: Db) {
  return {
    areas: all<{ id: string; name: string; summary: string | null }>(db, 'SELECT id, name, summary FROM areas'),
    topics: all<{ id: string; title: string; summary: string | null; area_id: string | null }>(
      db,
      'SELECT id, title, summary, area_id FROM topics',
    ),
    pendingTitles: [] as string[],
    subtopicIds: parentEdges(db).map(([child]) => child),
  }
}

describe('capture', () => {
  it('flags unknown ids and duplicate titles so the call is retried', () => {
    const db = fresh()
    const ctx = captureContext(db)
    const output: CaptureOutput = {
      new_areas: [],
      topics: [
        { ref: 't1', title: 'Typer', summary: '', why_i_care: null, area_id: 'nope', new_area_ref: null, parent_topic_id: null, parent_ref: null, rationale: '' },
        { ref: 't2', title: 'typer', summary: '', why_i_care: null, area_id: null, new_area_ref: 'a9', parent_topic_id: null, parent_ref: null, rationale: '' },
      ],
      duplicates: [],
    }
    const problems = checkCapture(output, ctx)
    expect(problems.join('\n')).toMatch(/unknown area_id/)
    expect(problems.join('\n')).toMatch(/appears twice/)
    expect(problems.join('\n')).toMatch(/unknown new_area_ref/)
  })

  it('creates a new area once, makes its topics depend on it, and skips existing topics', () => {
    const db = fresh()
    createTopic(db, USER, { title: 'Dimensional modelling' })
    const ctx = captureContext(db)
    const output: CaptureOutput = {
      new_areas: [{ ref: 'py', name: 'Python', summary: 'The language and its tooling' }],
      topics: [
        { ref: 't3', title: 'CLI tools with Typer', summary: 's', why_i_care: null, area_id: null, new_area_ref: 'py', parent_topic_id: null, parent_ref: null, rationale: 'r' },
        { ref: 't4', title: 'ABCs and Protocols', summary: 's', why_i_care: null, area_id: null, new_area_ref: 'py', parent_topic_id: null, parent_ref: null, rationale: 'r' },
        { ref: 't5', title: 'dimensional modelling', summary: 's', why_i_care: null, area_id: null, new_area_ref: null, parent_topic_id: null, parent_ref: null, rationale: 'r' },
      ],
      duplicates: [],
    }
    const { drafts, skipped, newAreas } = captureDrafts(output, ctx)
    expect(newAreas).toBe(1)
    expect(drafts.map((d) => d.kind)).toEqual(['create_area', 'create_topic', 'create_topic'])
    expect(drafts[1].depends_on_id).toBe(drafts[0].id)
    expect(skipped).toHaveLength(1)

    const runId = fakeRun(db, 'capture')
    createProposals(db, runId, drafts)
    // Accepting a topic before its new area is refused with a clear message.
    expect(() => acceptProposal(db, drafts[1].id)).toThrow(/Accept "New area "Python"" first/)
    // Accepting the whole run applies the area first.
    const results = acceptRun(db, runId)
    expect(results.map((r) => r.status)).toEqual(['accepted', 'accepted', 'accepted'])
    const topics = listTopics(db).filter((t) => t.area_id)
    expect(topics.map((t) => t.title).sort()).toEqual(['ABCs and Protocols', 'CLI tools with Typer'])
    expect(getTopicDetail(db, topics[0].id).events[0]).toMatchObject({ event_type: 'created', actor: 'proposal' })
  })

  it('rejecting a new area rejects the topics that depend on it', () => {
    const db = fresh()
    const output: CaptureOutput = {
      new_areas: [{ ref: 'go', name: 'Other languages', summary: '' }],
      topics: [{ ref: 't6', title: 'Go basics', summary: '', why_i_care: null, area_id: null, new_area_ref: 'go', parent_topic_id: null, parent_ref: null, rationale: '' }],
      duplicates: [],
    }
    const { drafts } = captureDrafts(output, captureContext(db))
    createProposals(db, fakeRun(db, 'capture'), drafts)
    rejectProposal(db, drafts[0].id)
    expect(listPendingGroups(db)).toHaveLength(0)
  })

  it('nests new topics under a new parent and puts them in its area', () => {
    const db = fresh()
    const area = createArea(db, { name: 'Data engineering' }).id
    const output: CaptureOutput = {
      new_areas: [],
      topics: [
        { ref: 'c', title: 'dbt testing', summary: '', why_i_care: null, area_id: null, new_area_ref: null, parent_topic_id: null, parent_ref: 'p', rationale: '' },
        { ref: 'p', title: 'dbt', summary: '', why_i_care: null, area_id: area, new_area_ref: null, parent_topic_id: null, parent_ref: null, rationale: '' },
      ],
      duplicates: [],
    }
    expect(checkCapture(output, captureContext(db))).toEqual([])
    const { drafts } = captureDrafts(output, captureContext(db))
    expect(drafts.map((d) => d.kind === 'create_topic' && d.payload.title)).toEqual(['dbt', 'dbt testing'])
    expect(drafts[1].depends_on_id).toBe(drafts[0].id)
    const runId = fakeRun(db, 'capture')
    createProposals(db, runId, drafts)
    expect(listPendingGroups(db)[0].proposals[1].description).toBe('Add "dbt testing" to Data engineering under "dbt"')
    acceptRun(db, runId)
    const child = listTopics(db).find((t) => t.title === 'dbt testing')!
    expect(child.area_id).toBe(area)
    expect(getTopicDetail(db, child.id).parent?.title).toBe('dbt')

    const deeper = { ...output, topics: [{ ...output.topics[0], ref: 'x', title: 'Deeper', parent_ref: null, parent_topic_id: child.id }] }
    expect(checkCapture(deeper, captureContext(db)).join()).toMatch(/only one level deep/)
  })

  it('marks a proposal failed, not accepted, when it can no longer apply', () => {
    const db = fresh()
    const { drafts } = captureDrafts(
      {
        new_areas: [],
        topics: [{ ref: 't7', title: 'Evals', summary: '', why_i_care: null, area_id: null, new_area_ref: null, parent_topic_id: null, parent_ref: null, rationale: '' }],
        duplicates: [],
      },
      captureContext(db),
    )
    createProposals(db, fakeRun(db, 'capture'), drafts)
    createTopic(db, USER, { title: 'Evals' }) // added by hand while the suggestion waited
    expect(acceptProposal(db, drafts[0].id)).toMatchObject({ status: 'failed', decision_note: expect.stringMatching(/already exists/) })
  })
})

describe('organise', () => {
  it('rejects a batch whose prerequisites form a loop', () => {
    const db = fresh()
    const [a, b] = ['Closures', 'Decorators'].map((title) => createTopic(db, USER, { title }).id)
    const ctx = { areas: [], topics: listTopics(db).map((t) => ({ id: t.id, title: t.title, summary: null, area_id: null, status: 'backlog' as const, parent_topic_id: null })), links: [] }
    const out: OrganiseOutput = {
      new_areas: [],
      area_updates: [],
      moves: [],
      merges: [],
      new_links: [
        { from_topic_id: a, to_topic_id: b, link_type: 'prerequisite_of', rationale: '' },
        { from_topic_id: b, to_topic_id: a, link_type: 'prerequisite_of', rationale: '' },
      ],
      removed_links: [],
      groupings: [],
    }
    expect(checkOrganise(db, out, ctx).join('\n')).toMatch(/loop/)
  })

  it('scopes suggestions to areas for the "N suggestions to review" badge', () => {
    const db = fresh()
    const area = createArea(db, { name: 'Python' }).id
    const [a, b] = ['Closures', 'Decorators'].map((title) => createTopic(db, USER, { title, area_id: area }).id)
    createLink(db, { from_topic_id: a, to_topic_id: b, link_type: 'related_to' })
    const drafts = organiseDrafts({
      new_areas: [],
      area_updates: [{ area_id: area, name: null, summary: 'Language features', rationale: '' }],
      moves: [],
      merges: [],
      new_links: [{ from_topic_id: a, to_topic_id: b, link_type: 'prerequisite_of', rationale: 'Decorators are closures' }],
      removed_links: [],
      groupings: [],
    })
    createProposals(db, fakeRun(db, 'organise'), drafts)
    expect(pendingCountsByArea(db).get(area)).toBe(2)
  })
})

describe('organise groupings', () => {
  const empty = { new_areas: [], area_updates: [], moves: [], merges: [], new_links: [], removed_links: [] }
  const contextOf = (db: Db) => ({
    areas: all<{ id: string; name: string; summary: string | null }>(db, 'SELECT id, name, summary FROM areas'),
    topics: listTopics(db).map((t) => ({ id: t.id, title: t.title, summary: null, area_id: t.area_id, status: t.status.effective, parent_topic_id: null })),
    links: [],
  })

  it('groups existing topics under a new parent in their area', () => {
    const db = fresh()
    const area = createArea(db, { name: 'Data engineering' }).id
    const ids = ['dbt fundamentals', 'dbt testing'].map((title) => createTopic(db, USER, { title, area_id: area }).id)
    const out: OrganiseOutput = {
      ...empty,
      groupings: [{ parent_topic_id: null, new_parent: { title: 'dbt', summary: 'The tool', area_id: null }, child_topic_ids: ids, rationale: 'Same tool' }],
    }
    expect(checkOrganise(db, out, contextOf(db))).toEqual([])
    const drafts = organiseDrafts(out, () => area)
    expect(drafts.map((d) => d.kind)).toEqual(['create_topic', 'create_link', 'create_link'])
    const runId = fakeRun(db, 'organise')
    createProposals(db, runId, drafts)
    expect(acceptRun(db, runId).every((r) => r.status === 'accepted')).toBe(true)
    const parent = listTopics(db).find((t) => t.title === 'dbt')!
    expect(parent.area_id).toBe(area)
    expect(getTopicDetail(db, parent.id).subtopics.map((s) => s.title)).toEqual(['dbt fundamentals', 'dbt testing'])
  })

  it('refuses groupings that nest deeper than one level', () => {
    const db = fresh()
    const [a, b, c] = ['A', 'B', 'C'].map((title) => createTopic(db, USER, { title }).id)
    const out: OrganiseOutput = {
      ...empty,
      new_links: [{ from_topic_id: b, to_topic_id: a, link_type: 'part_of', rationale: '' }],
      groupings: [{ parent_topic_id: b, new_parent: null, child_topic_ids: [c], rationale: '' }],
    }
    expect(checkOrganise(db, out, contextOf(db)).join()).toMatch(/one level deep/)
    const taken: OrganiseOutput = {
      ...empty,
      groupings: [{ parent_topic_id: null, new_parent: { title: 'a', summary: '', area_id: null }, child_topic_ids: [b, c], rationale: '' }],
    }
    expect(checkOrganise(db, taken, contextOf(db)).join()).toMatch(/already exists/)
  })
})

describe('api', () => {
  it('serves the home page and explains when AI is not configured', async () => {
    const db = fresh()
    const app = createApp(db, { aiAvailable: () => false })
    const home = await app.request('/api/home')
    expect(home.status).toBe(200)
    expect(await home.json()).toMatchObject({ aiAvailable: false, topicCount: 0 })

    const capture = await app.request('/api/capture', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'learn rust' }),
    })
    expect(capture.status).toBe(503)
    expect((await capture.json()).error).toMatch(/ANTHROPIC_API_KEY/)
  })

  it('validates input and returns readable errors', async () => {
    const app = createApp(fresh(), { aiAvailable: () => false })
    const res = await app.request('/api/topics', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '' }),
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/title/)
  })
})
