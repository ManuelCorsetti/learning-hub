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

const after = z.string().nullable().describe('id of the block this goes after; null for the very start')

export const EditorOutput = z.object({
  reply: z.string().min(1).max(2000).describe('What you say to the person: short, plain, no preamble'),
  patch: z
    .object({
      change_note: z.string().min(1).max(200).describe('One line for the version history, e.g. "BigQuery MERGE example in block 3"'),
      ops: z
        .array(
          z.discriminatedUnion('op', [
            z.object({
              op: z.literal('replace'),
              block_id: z.string(),
              keeps_schedule: z
                .boolean()
                .describe('Questions only: true if the new question still tests the same thing (reworded), false if it tests something different'),
              block: GeneratedBlock,
            }),
            z.object({ op: z.literal('add'), after_block_id: after, block: GeneratedBlock }),
            z.object({ op: z.literal('remove'), block_id: z.string() }),
            z.object({ op: z.literal('move'), block_id: z.string(), after_block_id: after }),
          ]),
        )
        .min(1),
    })
    .nullable()
    .describe('null when the note needs no change to the lesson'),
})
export type EditorOutput = z.infer<typeof EditorOutput>

/**
 * Turns Claude's operations into stored ones: a replaced block keeps its id unless it is a
 * question that now tests something different; added blocks get new ids.
 */
export function normaliseOps(base: Block[], ops: NonNullable<EditorOutput['patch']>['ops'], newBlockId: (type: string) => string): LessonPatchOp[] {
  return ops.map((op): LessonPatchOp => {
    if (op.op === 'remove' || op.op === 'move') return op
    if (op.op === 'add') return { op: 'add', after_block_id: op.after_block_id, block: { ...op.block, id: newBlockId(op.block.type) } as Block }
    const was = base.find((b) => b.id === op.block_id)
    const keep = !was || isTeaching(op.block) || (op.keeps_schedule && was.type === op.block.type)
    return { op: 'replace', block_id: op.block_id, block: { ...op.block, id: keep ? op.block_id : newBlockId(op.block.type) } as Block }
  })
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
    check: (out) => (out.patch ? patchProblems(blocks, normaliseOps(blocks, out.patch.ops, (t) => `${t}-check${n++}`), { requireProject }) : []),
    effort: 'high',
  })

  let proposalId: string | null = null
  if (result.patch) {
    proposalId = newId()
    createProposals(db, runId, [
      {
        id: proposalId,
        kind: 'lesson_patch',
        payload: {
          lesson_id: lessonId,
          base_version_id: version.id,
          change_note: result.patch.change_note,
          ops: normaliseOps(blocks, result.patch.ops, randomBlockId),
        },
        rationale: result.reply,
      },
    ])
    supersedeLessonPatches(db, lessonId, proposalId)
  }
  addMessage(db, lessonId, { role: 'assistant', content: result.reply, proposal_id: proposalId, ai_run_id: runId })
  return listMessages(db, lessonId)
}
