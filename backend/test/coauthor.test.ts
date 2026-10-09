import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { describe, expect, it } from 'vitest'
import type { Block } from '../../shared/lessons'
import { editToOps, EditorOutput, parseEditedBlocks } from '../src/ai/lessonEditor'
import { createApp } from '../src/app'
import { all, get, openDb, type Db } from '../src/db/connection'
import { newId } from '../src/lib'
import { addMessage, listMessages, supersedeLessonPatches, topicNotes } from '../src/services/coauthor'
import { USER } from '../src/services/events'
import { applyPatch, describePatch, patchProblems } from '../src/services/lessonPatch'
import { createLesson, getLessonView, latestVersion, restoreVersion } from '../src/services/lessons'
import { recordAttempt, startSession } from '../src/services/practice'
import { acceptProposal, createProposals, rejectProposal } from '../src/services/proposals'
import { createTopic } from '../src/services/topics'

const concept = (id: string, title = id): Block => ({ type: 'concept', id, title, body_markdown: 'Text', callout: null })
const tf = (id: string, statement = 'It is so.'): Block => ({ type: 'quiz_true_false', id, statement, answer: true, pitfall_note: 'P' })
const project: Block = { type: 'project_prompt', id: 'project', description: 'D', success_criteria: ['x'] }
const base = [concept('c1', 'Change events'), tf('q1'), concept('c2', 'Offsets'), tf('q2'), project]

function setup(db: Db) {
  const topicId = createTopic(db, USER, { title: 'CDC' }).id
  const { lessonId, versionId } = createLesson(db, { topicId, title: 'CDC basics', origin: 'ai', blocks: base, createdBy: 'ai' })
  return { topicId, lessonId, versionId }
}

function fakeRun(db: Db): string {
  const id = newId()
  db.prepare(
    `INSERT INTO ai_runs (id, task, prompt_name, prompt_hash, model, request_json, attempts_json, outcome, attempt_count, created_at)
     VALUES (?, 'lesson_patch', 'test', 'x', 'test', '{}', '[]', 'ok', 1, ?)`,
  ).run(id, new Date().toISOString())
  return id
}

describe('lesson patches', () => {
  it('applies operations in order and reports unknown ids', () => {
    const { blocks } = applyPatch(base, [
      { op: 'replace', block_id: 'c1', block: concept('c1', 'Change events, simply') },
      { op: 'add', after_block_id: 'q1', block: tf('q3') },
      { op: 'remove', block_id: 'q2' },
      { op: 'move', block_id: 'c2', after_block_id: null },
    ])
    expect(blocks.map((b) => b.id)).toEqual(['c2', 'c1', 'q1', 'q3', 'project'])
    expect(applyPatch(base, [{ op: 'remove', block_id: 'nope' }]).problems.join()).toMatch(/not in the lesson/)
    // A question replaced under a new id can still be referred to by its old id.
    const renamed = applyPatch(base, [
      { op: 'replace', block_id: 'q1', block: tf('q1-new') },
      { op: 'add', after_block_id: 'q1', block: tf('q3') },
    ])
    expect(renamed.problems).toEqual([])
    expect(renamed.blocks.map((b) => b.id)).toEqual(['c1', 'q1-new', 'q3', 'c2', 'q2', 'project'])
  })

  it('checks the lesson rules on the result', () => {
    expect(patchProblems(base, [{ op: 'move', block_id: 'project', after_block_id: 'c1' }]).join()).toMatch(/last block/)
    expect(patchProblems(base, [{ op: 'replace', block_id: 'q1', block: { ...concept('q1') } }]).join()).toMatch(/needs a new id/)
    expect(patchProblems(base, [{ op: 'add', after_block_id: 'q2', block: tf('q3') }])).toEqual([])
  })

  it('turns an edited lesson into operations; a question keeps its schedule only by keeping its id', () => {
    let n = 0
    const newId = (type: string) => `${type}-new${n++}`
    const keep = (id: string) => ({ type: 'keep' as const, id })
    const { ops, problems } = editToOps(
      base,
      [
        { ...concept('c2', 'Offsets'), id: 'c2' }, // unchanged content, moved to the front
        { ...concept('c1', 'Change events, simply'), id: 'c1' }, // reworded teaching
        { ...tf('q1', 'Reworded.'), id: 'q1' }, // same question, reworded: schedule kept
        { ...tf('x', 'Brand new.'), id: null }, // new question
        { ...tf('q2', 'Tests something else.'), id: null }, // replaces q2 under a new id: schedule restarts
        keep('project'),
      ],
      newId,
    )
    expect(problems).toEqual([])
    expect(ops.map((o) => `${o.op}:${'block' in o ? o.block.id : o.block_id}`)).toEqual([
      'replace:c1',
      'replace:q1',
      'move:c2',
      'add:quiz_true_false-new0',
      'add:quiz_true_false-new1',
      'remove:q2',
    ])
    const result = applyPatch(base, ops).blocks.map((b) => b.id)
    expect(result).toEqual(['c2', 'c1', 'q1', 'quiz_true_false-new0', 'quiz_true_false-new1', 'project'])
    expect(describePatch(base, ops).map((c) => `${c.kind}:${c.schedule}`)).toEqual([
      'changed:null',
      'changed:kept',
      'moved:null',
      'added:new',
      'added:new',
      'removed:retired',
    ])

    // Only one block added: no moves, no other noise.
    const small = editToOps(base, [keep('c1'), keep('q1'), { ...tf('x'), id: null }, keep('c2'), keep('q2'), keep('project')], newId)
    expect(small.ops.map((o) => o.op)).toEqual(['add'])
    expect(editToOps(base, base.map((b) => keep(b.id)), newId).ops).toEqual([])
    expect(editToOps(base, [keep('nope'), keep('c1'), keep('c1')], newId).problems).toEqual([
      'blocks[0] (keep): "nope" is not a block of the current lesson',
      'blocks[2]: block "c1" appears twice',
    ])
  })

  it('accepting writes a new version; a stale patch fails; rollback copies an older version', () => {
    const db = openDb(':memory:')
    const { lessonId, versionId } = setup(db)
    const item = get<{ id: string }>(db, "SELECT id FROM review_items WHERE block_id = 'q1'")!.id
    recordAttempt(db, { session_id: startSession(db, 'lesson', versionId), review_item_id: item, answer: { value: true } })

    const patch = (id: string, ops: never[] | object[]) =>
      createProposals(db, fakeRun(db), [
        { id, kind: 'lesson_patch', payload: { lesson_id: lessonId, base_version_id: versionId, change_note: 'n', ops } as never, rationale: null },
      ])
    patch('p1', [{ op: 'replace', block_id: 'q1', block: tf('q1', 'Reworded.') }, { op: 'remove', block_id: 'q2' }])
    patch('p2', [{ op: 'remove', block_id: 'q1' }])
    expect(acceptProposal(db, 'p1').status).toBe('accepted')
    const view = getLessonView(db, lessonId)
    expect(view.version.version_no).toBe(2)
    expect(view.items.q1.attempts).toBe(1) // same id: schedule carries on
    expect(view.items.q2).toBeUndefined() // retired
    expect(acceptProposal(db, 'p2')).toMatchObject({ status: 'failed', decision_note: expect.stringMatching(/changed since/) })

    restoreVersion(db, lessonId, versionId)
    const restored = getLessonView(db, lessonId)
    expect(restored.version).toMatchObject({ version_no: 3, change_note: 'Restored version 1' })
    expect(restored.items.q2).toBeDefined()
    expect(restored.versions.map((v) => v.version_no)).toEqual([3, 2, 1])
    expect(() => restoreVersion(db, lessonId, latestVersion(db, lessonId).id)).toThrow(/already the current/)
  })

  it('keeps the thread, shows each suggested edit and supersedes older ones', async () => {
    const db = openDb(':memory:')
    const { topicId, lessonId, versionId } = setup(db)
    addMessage(db, lessonId, { role: 'user', content: 'Use a BigQuery example', block_id: 'c1' })
    createProposals(db, fakeRun(db), [
      { id: 'p1', kind: 'lesson_patch', payload: { lesson_id: lessonId, base_version_id: versionId, change_note: 'BQ example', ops: [{ op: 'remove', block_id: 'q2' }] }, rationale: null },
    ])
    addMessage(db, lessonId, { role: 'assistant', content: 'Done', proposal_id: 'p1' })
    createProposals(db, fakeRun(db), [
      { id: 'p2', kind: 'lesson_patch', payload: { lesson_id: lessonId, base_version_id: versionId, change_note: 'Other', ops: [{ op: 'remove', block_id: 'q1' }] }, rationale: null },
    ])
    expect(supersedeLessonPatches(db, lessonId, 'p2')).toBe(1)
    const thread = listMessages(db, lessonId)
    expect(thread.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(thread[1].patch).toMatchObject({ status: 'superseded', base_version_no: 1, stale: false, changes: [{ kind: 'removed', schedule: 'retired' }] })
    expect(topicNotes(db, topicId)).toEqual([{ lesson: 'CDC basics', note: 'Use a BigQuery example' }])
    rejectProposal(db, 'p2')
    expect(all(db, "SELECT 1 FROM lesson_versions WHERE lesson_id = ?", lessonId)).toHaveLength(1)

    const app = createApp(db, { aiAvailable: () => false })
    expect((await app.request(`/api/lessons/${lessonId}/thread`)).status).toBe(200)
    const send = await app.request(`/api/lessons/${lessonId}/thread`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'harder please' }),
    })
    expect(send.status).toBe(503)
  })

  it('keeps the output grammar tiny and validates the edited blocks itself', () => {
    // Constraining the blocks in the grammar was rejected by the API: "The compiled grammar is too large".
    expect(JSON.stringify(betaZodOutputFormat(EditorOutput).schema)).not.toContain('anyOf')
    const keep = JSON.stringify([{ type: 'keep', id: 'c1' }, { type: 'quiz_true_false', id: null, statement: 'S', answer: true, pitfall_note: 'P' }])
    expect(parseEditedBlocks(keep)).toMatchObject({ problems: [], blocks: [{ type: 'keep' }, { type: 'quiz_true_false' }] })
    expect(parseEditedBlocks('[]')).toEqual({ blocks: [], problems: [] })
    expect(parseEditedBlocks('{oops').problems).toEqual(['blocks_json is not valid JSON'])
    expect(parseEditedBlocks(JSON.stringify([{ type: 'quiz_mcq', id: null, question: 'Q', options: ['a'], correct_index: 0, pitfall_note: 'p' }])).problems[0]).toMatch(/blocks_json/)
  })


})
