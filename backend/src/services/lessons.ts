// Lessons are append-only series of versions. Each interactive block id becomes a review item
// the first time it appears and is retired when a later version drops it (data-model rules 7–9).
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import type { LessonAuthor, LessonOrigin, ReviewState } from '../../../shared/domain'
import type { ItemProgress, LessonSummary, LessonView } from '../../../shared/api'
import { Block, LESSON_SCHEMA_VERSION, isInteractive, isScheduledType, lessonProblems } from '../../../shared/lessons'
import { all, get, run, tx, type Db } from '../db/connection'
import { AppError, clean, newId, notFound, nowIso } from '../lib'
import { measureTopics } from './status'
import { requireLiveTopic } from './topics'

export interface LessonRow {
  id: string
  topic_id: string
  title: string
  origin: LessonOrigin
  archived_at: string | null
  created_at: string
  updated_at: string
}

export interface LessonVersionRow {
  id: string
  lesson_id: string
  version_no: number
  schema_version: number
  blocks_json: string
  created_by: LessonAuthor
  change_note: string | null
  based_on_version_id: string | null
  source_proposal_id: string | null
  ai_run_id: string | null
  created_at: string
}

export interface NewVersion {
  blocks: { type: string; id: string | null }[]
  createdBy: LessonAuthor
  changeNote?: string | null
  basedOnVersionId?: string | null
  aiRunId?: string | null
}

const shortId = () => randomBytes(4).toString('hex')

/** Gives every block without an id a new one, e.g. "quiz_mcq-3f9a12c0". */
export function assignIds<T extends { type: string; id: string | null }>(blocks: T[]): (T & { id: string })[] {
  const taken = new Set(blocks.map((b) => b.id).filter(Boolean))
  return blocks.map((b) => {
    if (b.id) return b as T & { id: string }
    let id = `${b.type}-${shortId()}`
    while (taken.has(id)) id = `${b.type}-${shortId()}`
    taken.add(id)
    return { ...b, id }
  })
}

/** Schema + lesson rules. Throws a 400 listing every problem. */
export function validateBlocks(blocks: unknown[]): Block[] {
  const parsed = z.array(Block).safeParse(blocks)
  if (!parsed.success) throw new AppError(`Invalid lesson: ${z.prettifyError(parsed.error)}`)
  const problems = lessonProblems(parsed.data)
  if (problems.length) throw new AppError(`Invalid lesson: ${problems.join('; ')}`)
  return parsed.data
}

export function getLesson(db: Db, id: string): LessonRow | undefined {
  return get<LessonRow>(db, 'SELECT * FROM lessons WHERE id = ?', id)
}

export function requireLesson(db: Db, id: string): LessonRow {
  const lesson = getLesson(db, id)
  if (!lesson) throw notFound('Lesson')
  return lesson
}

export function latestVersion(db: Db, lessonId: string): LessonVersionRow {
  const v = get<LessonVersionRow>(
    db,
    'SELECT * FROM lesson_versions WHERE lesson_id = ? ORDER BY version_no DESC LIMIT 1',
    lessonId,
  )
  if (!v) throw notFound('Lesson version')
  return v
}

export const versionBlocks = (v: Pick<LessonVersionRow, 'blocks_json'>): Block[] => JSON.parse(v.blocks_json) as Block[]

export function createLesson(
  db: Db,
  input: { topicId: string; title: string; origin: LessonOrigin } & NewVersion,
): { lessonId: string; versionId: string } {
  return tx(db, () => {
    requireLiveTopic(db, input.topicId)
    const lessonId = newId()
    const now = nowIso()
    run(
      db,
      `INSERT INTO lessons (id, topic_id, title, origin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      lessonId,
      input.topicId,
      input.title.trim(),
      input.origin,
      now,
      now,
    )
    return { lessonId, versionId: addVersion(db, lessonId, input) }
  })
}

/** Appends a version and syncs review items. Returns the new version id. */
export function addVersion(db: Db, lessonId: string, input: NewVersion): string {
  return tx(db, () => {
    const lesson = requireLesson(db, lessonId)
    if (lesson.archived_at) throw new AppError('This lesson is archived', 409)
    const blocks = validateBlocks(assignIds(input.blocks))
    const items = all<{ block_id: string; block_type: string }>(
      db,
      'SELECT block_id, block_type FROM review_items WHERE lesson_id = ?',
      lessonId,
    )
    const typeOf = new Map(items.map((i) => [i.block_id, i.block_type]))
    for (const b of blocks.filter(isInteractive)) {
      const was = typeOf.get(b.id)
      if (was && was !== b.type) {
        throw new AppError(`Block "${b.id}" was a ${was}; a block that tests something different needs a new id`)
      }
    }
    const versionNo =
      (get<{ n: number | null }>(db, 'SELECT max(version_no) AS n FROM lesson_versions WHERE lesson_id = ?', lessonId)
        ?.n ?? 0) + 1
    const versionId = newId()
    const now = nowIso()
    run(
      db,
      `INSERT INTO lesson_versions (id, lesson_id, version_no, schema_version, blocks_json, created_by, change_note,
         based_on_version_id, ai_run_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      versionId,
      lessonId,
      versionNo,
      LESSON_SCHEMA_VERSION,
      JSON.stringify(blocks),
      input.createdBy,
      clean(input.changeNote),
      input.basedOnVersionId ?? null,
      input.aiRunId ?? null,
      now,
    )
    syncReviewItems(db, lessonId, versionId, blocks, now)
    run(db, 'UPDATE lessons SET updated_at = ? WHERE id = ?', now, lessonId)
    return versionId
  })
}

function syncReviewItems(db: Db, lessonId: string, versionId: string, blocks: Block[], now: string): void {
  const present = new Set(blocks.filter(isInteractive).map((b) => b.id))
  for (const b of blocks.filter(isInteractive)) {
    run(
      db,
      `INSERT INTO review_items (id, lesson_id, block_id, block_type, is_scheduled, first_version_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (lesson_id, block_id) DO UPDATE SET retired_at = NULL`,
      newId(),
      lessonId,
      b.id,
      b.type,
      isScheduledType(b.type),
      versionId,
      now,
    )
  }
  const live = all<{ id: string; block_id: string }>(
    db,
    'SELECT id, block_id FROM review_items WHERE lesson_id = ? AND retired_at IS NULL',
    lessonId,
  )
  for (const item of live.filter((i) => !present.has(i.block_id))) {
    run(db, 'UPDATE review_items SET retired_at = ? WHERE id = ?', now, item.id)
  }
}

export function listTopicLessons(db: Db, topicId: string): LessonSummary[] {
  return all<LessonRow & { version_no: number; blocks_json: string; version_created_at: string }>(
    db,
    `SELECT l.*, v.version_no, v.blocks_json, v.created_at AS version_created_at
     FROM lessons l
     JOIN lesson_versions v ON v.lesson_id = l.id
       AND v.version_no = (SELECT max(version_no) FROM lesson_versions WHERE lesson_id = l.id)
     WHERE l.topic_id = ? AND l.archived_at IS NULL
     ORDER BY l.created_at`,
    topicId,
  ).map((l) => {
    const blocks = versionBlocks(l)
    return {
      id: l.id,
      title: l.title,
      origin: l.origin,
      version_no: l.version_no,
      updated_at: l.version_created_at,
      questionCount: blocks.filter((b) => isScheduledType(b.type)).length,
      hasProject: blocks.some((b) => b.type === 'project_prompt'),
    }
  })
}

export function getLessonView(db: Db, lessonId: string): LessonView {
  const lesson = requireLesson(db, lessonId)
  const version = latestVersion(db, lessonId)
  const topic = get<{ id: string; title: string; area_id: string | null }>(
    db,
    'SELECT id, title, area_id FROM topics WHERE id = ?',
    lesson.topic_id,
  )!
  const rows = all<{
    id: string
    block_id: string
    is_scheduled: number
    attempts: number
    last_correct: number | null
    state: ReviewState | null
    due_at: string | null
  }>(
    db,
    `SELECT ri.id, ri.block_id, ri.is_scheduled, s.state, s.due_at,
       (SELECT count(*) FROM attempts a WHERE a.review_item_id = ri.id) AS attempts,
       (SELECT a.is_correct FROM attempts a WHERE a.review_item_id = ri.id ORDER BY a.answered_at DESC, a.id DESC LIMIT 1)
         AS last_correct
     FROM review_items ri LEFT JOIN review_item_state s ON s.review_item_id = ri.id
     WHERE ri.lesson_id = ? AND ri.retired_at IS NULL`,
    lessonId,
  )
  const items: Record<string, ItemProgress> = {}
  for (const r of rows) {
    items[r.block_id] = {
      review_item_id: r.id,
      is_scheduled: r.is_scheduled === 1,
      attempts: r.attempts,
      last_correct: r.last_correct === null ? null : r.last_correct === 1,
      state: r.state,
      due_at: r.due_at,
    }
  }
  const versionCount = get<{ n: number }>(db, 'SELECT count(*) AS n FROM lesson_versions WHERE lesson_id = ?', lessonId)!.n
  return {
    id: lesson.id,
    title: lesson.title,
    origin: lesson.origin,
    archived_at: lesson.archived_at,
    topic,
    version: {
      id: version.id,
      version_no: version.version_no,
      created_by: version.created_by,
      change_note: version.change_note,
      created_at: version.created_at,
    },
    versionCount,
    blocks: versionBlocks(version),
    items,
    measurement: measureTopics(db, [topic.id]).get(topic.id)!,
  }
}
