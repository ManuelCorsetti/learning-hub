// Co-author: a note about a lesson (or one block) → a reply and, when the note asks for a
// change, a lesson_patch proposal. Nothing changes until the person accepts it.
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import type { ChatMessageView } from '../../../shared/api'
import { EditedBlock, type Block } from '../../../shared/lessons'
import type { LessonPatchOp } from '../../../shared/proposals'
import { all, type Db } from '../db/connection'
import { AppError, newId } from '../lib'
import { addMessage, listMessages, supersedeLessonPatches } from '../services/coauthor'
import { applyPatch, patchProblems } from '../services/lessonPatch'
import { latestVersion, requireLesson, versionBlocks } from '../services/lessons'
import { createProposals } from '../services/proposals'
import { callStructured } from './client'
import { topicContext } from './lessons'

// The edited blocks travel as a JSON string, validated here against the block schemas (with the
// usual retry). Every attempt to constrain them in the output grammar itself was rejected by the
// API as "compiled grammar is too large".
export const EditorOutput = z.object({
  reply: z.string().min(1).max(2000).describe('What you say to the person: short, plain, no preamble'),
  change_note: z.string().max(200).describe('One line for the version history; empty when nothing changes'),
  blocks_json: z
    .string()
    .describe('JSON array: the whole lesson after your edit, in order, with {"type":"keep","id":"…"} for unchanged blocks. "[]" when nothing changes.'),
})
export type EditorOutput = z.infer<typeof EditorOutput>

/** Parses and validates blocks_json. */
export function parseEditedBlocks(json: string): { blocks: EditedBlock[]; problems: string[] } {
  if (!json.trim()) return { blocks: [], problems: [] }
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return { blocks: [], problems: ['blocks_json is not valid JSON'] }
  }
  const parsed = z.array(EditedBlock).safeParse(raw)
  return parsed.success
    ? { blocks: parsed.data, problems: [] }
    : { blocks: [], problems: [`blocks_json: ${z.prettifyError(parsed.error)}`] }
}

/**
 * Turns the edited block list into patch operations against the current version: removals for
 * blocks left out, replacements for changed blocks that keep their id, additions for new blocks,
 * and moves where the order changed. A question keeps its review schedule only if it keeps its id.
 */
export function editToOps(base: Block[], edited: EditedBlock[], newBlockId: (type: string) => string): { ops: LessonPatchOp[]; problems: string[] } {
  const problems: string[] = []
  const byId = new Map(base.map((b) => [b.id, b]))
  const used = new Set<string>()
  const replaces: LessonPatchOp[] = []
  const target: Block[] = []
  edited.forEach((e, n) => {
    if (e.type === 'keep') {
      const kept = byId.get(e.id)
      if (!kept) return void problems.push(`blocks[${n}] (keep): "${e.id}" is not a block of the current lesson`)
      if (used.has(e.id)) return void problems.push(`blocks[${n}]: block "${e.id}" appears twice`)
      used.add(e.id)
      return void target.push(kept)
    }
    const was = e.id ? byId.get(e.id) : undefined
    if (was && was.type === e.type && !used.has(was.id)) {
      used.add(was.id)
      const block = { ...e, id: was.id } as Block
      if (JSON.stringify(block) !== JSON.stringify(was)) replaces.push({ op: 'replace', block_id: was.id, block })
      return void target.push(block)
    }
    target.push({ ...e, id: newBlockId(e.type) } as Block)
  })
  const removes: LessonPatchOp[] = base.filter((b) => !used.has(b.id)).map((b) => ({ op: 'remove', block_id: b.id }))
  // Walk the target order and add or move whatever is not already after the block it should follow.
  const placed: LessonPatchOp[] = []
  const current = applyPatch(base, [...removes, ...replaces]).blocks.map((b) => b.id)
  target.forEach((b, i) => {
    const after = i === 0 ? null : target[i - 1].id
    const at = current.indexOf(b.id)
    if (at !== -1 && (at === 0 ? null : current[at - 1]) === after) return
    if (at === -1) placed.push({ op: 'add', after_block_id: after, block: b })
    else {
      current.splice(at, 1)
      placed.push({ op: 'move', block_id: b.id, after_block_id: after })
    }
    current.splice(after === null ? 0 : current.indexOf(after) + 1, 0, b.id)
  })
  return { ops: [...replaces, ...placed, ...removes], problems }
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
      const edited = parseEditedBlocks(out.blocks_json)
      if (edited.problems.length) return edited.problems
      if (!edited.blocks.length) return []
      const { ops, problems } = editToOps(blocks, edited.blocks, (t) => `${t}-check${n++}`)
      if (problems.length) return problems
      if (!ops.length) return ['the edited lesson is identical to the current one; return an empty blocks list when nothing changes']
      if (!out.change_note.trim()) return ['change_note is required when the lesson changes']
      return patchProblems(blocks, ops, { requireProject })
    },
    effort: 'high',
  })

  // The note is saved with the reply, so a failed call leaves no orphan note; the panel keeps the text to resend.
  addMessage(db, lessonId, { role: 'user', content: input.message, block_id: input.block_id })
  let proposalId: string | null = null
  const edit = editToOps(blocks, parseEditedBlocks(result.blocks_json).blocks, randomBlockId)
  if (edit.ops.length) {
    proposalId = newId()
    createProposals(db, runId, [
      {
        id: proposalId,
        kind: 'lesson_patch',
        payload: {
          lesson_id: lessonId,
          base_version_id: version.id,
          change_note: result.change_note,
          ops: edit.ops,
        },
        rationale: result.reply,
      },
    ])
    supersedeLessonPatches(db, lessonId, proposalId)
  }
  addMessage(db, lessonId, { role: 'assistant', content: result.reply, proposal_id: proposalId, ai_run_id: runId })
  return listMessages(db, lessonId)
}
