// Co-author: a note about a lesson (or one block) → a reply and, when the note asks for a
// change, a lesson_patch proposal. Nothing changes until the person accepts it.
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import type { ChatMessageView } from '../../../shared/api'
import { GeneratedBlock, isTeaching, type Block } from '../../../shared/lessons'
import type { LessonPatchOp } from '../../../shared/proposals'
import { all, type Db } from '../db/connection'
import { AppError, newId } from '../lib'
import { addMessage, listMessages, supersedeLessonPatches } from '../services/coauthor'
import { patchProblems } from '../services/lessonPatch'
import { latestVersion, requireLesson, versionBlocks } from '../services/lessons'
import { createProposals } from '../services/proposals'
import { callStructured } from './client'
import { topicContext } from './lessons'

// Kept flat on purpose: the block union appears exactly once and is never nullable, as in
// GeneratedLesson. Nesting it inside a union of ops compiled to a grammar the API rejected as
// too large.
const EditorChange = z.object({
  op: z.enum(['replace', 'add']),
  block_id: z.string().nullable().describe('replace: id of the block to replace; add: null'),
  after_block_id: z.string().nullable().describe('add: id of the block this goes after, null for the very start; replace: null'),
  keeps_schedule: z
    .boolean()
    .describe('replace of a question: true if it still tests the same thing (reworded), false if it tests something different; otherwise false'),
  block: GeneratedBlock,
})
type EditorChange = z.infer<typeof EditorChange>

export const EditorOutput = z.object({
  reply: z.string().min(1).max(2000).describe('What you say to the person: short, plain, no preamble'),
  change_note: z.string().max(200).describe('One line for the version history; empty when nothing changes'),
  changes: z.array(EditorChange).describe('Blocks replaced or added, applied in order'),
  moves: z
    .array(z.object({ block_id: z.string(), after_block_id: z.string().nullable() }))
    .describe('Applied after changes; after_block_id null = the very start'),
  removals: z.array(z.string()).describe('Ids of blocks to remove, applied last'),
})
export type EditorOutput = z.infer<typeof EditorOutput>

export const hasEdits = (out: EditorOutput) => out.changes.length + out.moves.length + out.removals.length > 0

/** A replace needs the id of the block it replaces. */
export function changeProblems(changes: EditorChange[]): string[] {
  return changes.flatMap((c, n) => (c.op === 'replace' && !c.block_id ? [`changes[${n}] (replace): block_id is required`] : []))
}

/**
 * Turns Claude's edit into stored operations (changes, then moves, then removals): a replaced
 * block keeps its id unless it is a question that now tests something different; added blocks
 * get new ids. Call changeProblems first.
 */
export function normaliseOps(base: Block[], out: Pick<EditorOutput, 'changes' | 'moves' | 'removals'>, newBlockId: (type: string) => string): LessonPatchOp[] {
  const changes = out.changes.map((c): LessonPatchOp => {
    if (c.op === 'add') return { op: 'add', after_block_id: c.after_block_id, block: { ...c.block, id: newBlockId(c.block.type) } as Block }
    const was = base.find((b) => b.id === c.block_id)
    const keep = !was || isTeaching(c.block) || (c.keeps_schedule && was.type === c.block.type)
    return { op: 'replace', block_id: c.block_id!, block: { ...c.block, id: keep ? c.block_id! : newBlockId(c.block.type) } as Block }
  })
  return [
    ...changes,
    ...out.moves.map((m): LessonPatchOp => ({ op: 'move', block_id: m.block_id, after_block_id: m.after_block_id })),
    ...out.removals.map((id): LessonPatchOp => ({ op: 'remove', block_id: id })),
  ]
}

const randomBlockId = (type: string) => `${type}-${randomBytes(4).toString('hex')}`

/** How the person has done on each question of the lesson, so edits can target what is not working. */
function questionStats(db: Db, lessonId: string) {
  return all<{ block_id: string; attempts: number; correct: number; confidently_wrong: number; lapses: number | null }>(
    db,
    `SELECT ri.block_id,
       count(a.id) AS attempts,
       coalesce(sum(a.is_correct = 1), 0) AS correct,
       coalesce(sum(a.is_correct = 0 AND a.confidence = 3), 0) AS confidently_wrong,
       s.lapses
     FROM review_items ri
     LEFT JOIN attempts a ON a.review_item_id = ri.id
     LEFT JOIN review_item_state s ON s.review_item_id = ri.id
     WHERE ri.lesson_id = ? AND ri.retired_at IS NULL
     GROUP BY ri.id`,
    lessonId,
  ).filter((s) => s.attempts > 0)
}

export async function sendLessonMessage(
  db: Db,
  lessonId: string,
  input: { message: string; block_id?: string | null },
): Promise<ChatMessageView[]> {
  const lesson = requireLesson(db, lessonId)
  if (lesson.archived_at) throw new AppError('This lesson is archived', 409)
  const version = latestVersion(db, lessonId)
  const blocks = versionBlocks(version)
  if (input.block_id && !blocks.some((b) => b.id === input.block_id)) throw new AppError('That block is not in the current version')
  const history = listMessages(db, lessonId)
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content, block_id: m.block_id, edit: m.patch && { change_note: m.patch.change_note, status: m.patch.status } }))
  addMessage(db, lessonId, { role: 'user', content: input.message, block_id: input.block_id })

  const requireProject = lesson.origin !== 'placement'
  let n = 0
  const { runId, result } = await callStructured(db, {
    task: 'lesson_patch',
    promptName: 'lesson_editor',
    schema: EditorOutput,
    input: {
      ...topicContext(db, lesson.topic_id),
      lesson: { title: lesson.title, origin: lesson.origin, version: version.version_no, blocks },
      question_stats: questionStats(db, lessonId),
      conversation: history,
      note: { message: input.message, about_block_id: input.block_id ?? null },
    },
    check: (out) => {
      if (!hasEdits(out)) return []
      const problems = changeProblems(out.changes)
      if (!out.change_note.trim()) problems.push('change_note is required when the lesson changes')
      return problems.length
        ? problems
        : patchProblems(blocks, normaliseOps(blocks, out, (t) => `${t}-check${n++}`), { requireProject })
    },
    effort: 'high',
  })

  let proposalId: string | null = null
  if (hasEdits(result)) {
    proposalId = newId()
    createProposals(db, runId, [
      {
        id: proposalId,
        kind: 'lesson_patch',
        payload: {
          lesson_id: lessonId,
          base_version_id: version.id,
          change_note: result.change_note,
          ops: normaliseOps(blocks, result, randomBlockId),
        },
        rationale: result.reply,
      },
    ])
    supersedeLessonPatches(db, lessonId, proposalId)
  }
  addMessage(db, lessonId, { role: 'assistant', content: result.reply, proposal_id: proposalId, ai_run_id: runId })
  return listMessages(db, lessonId)
}
