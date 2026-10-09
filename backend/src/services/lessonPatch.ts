// Lesson patches: block operations on one lesson version, proposed by Claude and applied as a
// new version when accepted. A replaced question keeps its schedule only if it keeps its id.
import { z } from 'zod'
import type { PatchChange } from '../../../shared/api'
import { Block, isInteractive, isScheduledType, lessonProblems } from '../../../shared/lessons'
import type { LessonPatchOp } from '../../../shared/proposals'

const describeBlock = (b: Block) => ('title' in b ? `"${b.title}"` : b.type === 'diagram' ? `the ${b.diagram_key} diagram` : `"${b.id}"`)

/**
 * Applies operations in order. Unknown ids are reported, not ignored. Operations name blocks by
 * the ids of the version they were written against, so a block replaced under a new id can still
 * be found by its old one.
 */
export function applyPatch(blocks: Block[], ops: LessonPatchOp[]): { blocks: Block[]; problems: string[] } {
  const out = [...blocks]
  const problems: string[] = []
  const renamed = new Map<string, string>()
  const indexOf = (id: string) => out.findIndex((b) => b.id === (renamed.get(id) ?? id))
  const insertAfter = (afterId: string | null, block: Block, where: string) => {
    if (afterId === null) return void out.unshift(block)
    const i = indexOf(afterId)
    if (i === -1) problems.push(`${where}: after_block_id "${afterId}" is not in the lesson`)
    else out.splice(i + 1, 0, block)
  }
  ops.forEach((op, n) => {
    const where = `ops[${n}] (${op.op})`
    if (op.op === 'add') return insertAfter(op.after_block_id, op.block, where)
    const i = indexOf(op.block_id)
    if (i === -1) return void problems.push(`${where}: block_id "${op.block_id}" is not in the lesson`)
    if (op.op === 'replace') {
      out[i] = op.block
      if (op.block.id !== op.block_id) renamed.set(op.block_id, op.block.id)
    } else if (op.op === 'remove') out.splice(i, 1)
    else {
      const [moved] = out.splice(i, 1)
      insertAfter(op.after_block_id, moved, where)
    }
  })
  return { blocks: out, problems }
}

/** Schema, lesson rules and id rules for the lesson a patch would produce. */
export function patchProblems(base: Block[], ops: LessonPatchOp[], options: { requireProject?: boolean } = {}): string[] {
  const { blocks, problems } = applyPatch(base, ops)
  if (problems.length) return problems
  const parsed = z.array(Block).safeParse(blocks)
  if (!parsed.success) return [z.prettifyError(parsed.error)]
  const typeOf = new Map(base.map((b) => [b.id, b.type]))
  for (const b of parsed.data) {
    const was = typeOf.get(b.id)
    if (was && was !== b.type) problems.push(`block "${b.id}" was a ${was}; a different type needs a new id`)
  }
  return [...problems, ...lessonProblems(parsed.data, options)]
}

/** What a patch changes, for the diff view. */
export function describePatch(base: Block[], ops: LessonPatchOp[]): PatchChange[] {
  const byId = new Map(base.map((b) => [b.id, b]))
  const label = (id: string | null) => (id === null ? 'at the start' : byId.get(id) ? `after ${describeBlock(byId.get(id)!)}` : 'after a new block')
  return ops.map((op): PatchChange => {
    switch (op.op) {
      case 'replace': {
        const before = byId.get(op.block_id) ?? null
        const scheduled = isScheduledType(op.block.type)
        return {
          kind: 'changed',
          before,
          after: op.block,
          where: before ? describeBlock(before) : op.block_id,
          schedule: !scheduled ? null : op.block.id === op.block_id ? 'kept' : 'reset',
        }
      }
      case 'add':
        return {
          kind: 'added',
          before: null,
          after: op.block,
          where: label(op.after_block_id),
          schedule: isScheduledType(op.block.type) ? 'new' : null,
        }
      case 'remove': {
        const before = byId.get(op.block_id) ?? null
        return {
          kind: 'removed',
          before,
          after: null,
          where: before ? describeBlock(before) : op.block_id,
          schedule: before && isInteractive(before) && isScheduledType(before.type) ? 'retired' : null,
        }
      }
      case 'move': {
        const before = byId.get(op.block_id) ?? null
        return { kind: 'moved', before, after: before, where: label(op.after_block_id), schedule: null }
      }
    }
  })
}
