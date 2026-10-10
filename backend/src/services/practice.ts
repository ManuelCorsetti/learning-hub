// Study sessions, attempts and the Practice queue.
import type { StudySessionKind } from '../../../shared/domain'
import type { z } from 'zod'
import type { AttemptInput, AttemptResult, PracticeData, PracticeItem } from '../../../shared/api'
import type { InteractiveBlock } from '../../../shared/lessons'
import { all, get, run, tx, type Db } from '../db/connection'
import { AppError, conflict, newId, notFound, nowIso } from '../lib'
import { grade, isConfidentlyWrong, rate, type AiGrade, type Grade } from './grading'
import { latestVersion, versionBlocks, type LessonVersionRow } from './lessons'
import { refreshSchedule, type ReviewItemStateRow } from './scheduler'
import { resolveOverrides } from './topics'

interface SessionRow {
  id: string
  kind: StudySessionKind
  lesson_version_id: string | null
  started_at: string
  completed_at: string | null
}

/** Scheduled items that are live (not retired, in a live lesson of a live topic) and have a schedule. */
const SCHEDULED_ITEMS = `review_items ri
  JOIN lessons l ON l.id = ri.lesson_id AND l.archived_at IS NULL
  JOIN topics t ON t.id = l.topic_id AND t.archived_at IS NULL
  JOIN review_item_state s ON s.review_item_id = ri.id
  WHERE ri.is_scheduled = 1 AND ri.retired_at IS NULL`

export function startSession(db: Db, kind: StudySessionKind, lessonVersionId: string | null = null): string {
  if (kind !== 'review' && !lessonVersionId) throw new AppError('A lesson or placement session needs the lesson version')
  if (kind === 'review' && lessonVersionId) throw new AppError('A review session does not belong to a lesson version')
  if (lessonVersionId && !get(db, 'SELECT 1 FROM lesson_versions WHERE id = ?', lessonVersionId)) {
    throw notFound('Lesson version')
  }
  const id = newId()
  run(
    db,
    'INSERT INTO study_sessions (id, kind, lesson_version_id, started_at) VALUES (?, ?, ?, ?)',
    id,
    kind,
    lessonVersionId,
    nowIso(),
  )
  return id
}

export function completeSession(db: Db, id: string): void {
  if (!run(db, 'UPDATE study_sessions SET completed_at = coalesce(completed_at, ?) WHERE id = ?', nowIso(), id)) {
    throw notFound('Study session')
  }
}

/** The session, item and block an attempt refers to; throws when it cannot be recorded. */
export function attemptContext(db: Db, input: Pick<z.infer<typeof AttemptInput>, 'session_id' | 'review_item_id'>) {
  const session = get<SessionRow>(db, 'SELECT * FROM study_sessions WHERE id = ?', input.session_id)
  if (!session) throw notFound('Study session')
  if (session.completed_at) throw conflict('This study session has ended. Start a new one.')
  const item = get<{ id: string; lesson_id: string; block_id: string; retired_at: string | null }>(
    db,
    'SELECT id, lesson_id, block_id, retired_at FROM review_items WHERE id = ?',
    input.review_item_id,
  )
  if (!item) throw notFound('Review item')
  if (item.retired_at) throw conflict('This question was removed from its lesson')

  // Grade against the content that was shown: the session's version when it is this lesson's, else the latest.
  const sessionVersion = session.lesson_version_id
    ? get<LessonVersionRow>(
        db,
        'SELECT * FROM lesson_versions WHERE id = ? AND lesson_id = ?',
        session.lesson_version_id,
        item.lesson_id,
      )
    : undefined
  const version = sessionVersion ?? latestVersion(db, item.lesson_id)
  const block = versionBlocks(version).find((b) => b.id === item.block_id) as InteractiveBlock | undefined
  if (!block) throw conflict('This question is not in the lesson version being studied')
  return { session, item, version, block }
}

/**
 * Records an answer. `ai` is Claude's reading of a free-text answer the exact check marked wrong;
 * when given it replaces that result, and the attempt's answer_json notes who graded it.
 */
export function recordAttempt(
  db: Db,
  input: z.infer<typeof AttemptInput>,
  now = new Date(),
  ai?: { grade: Grade; info: AiGrade },
): AttemptResult {
  const result = tx(db, () => {
    const { session, item, version, block } = attemptContext(db, input)

    const confidence = input.confidence ?? null
    const graded = ai?.grade ?? grade(block, input.answer)
    const rating = rate(graded, confidence)
    const attemptId = newId()
    run(
      db,
      `INSERT INTO attempts (id, review_item_id, session_id, lesson_version_id, answer_json, is_correct, score,
         confidence, rating, duration_ms, answered_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      attemptId,
      item.id,
      session.id,
      version.id,
      JSON.stringify(ai ? { ...(input.answer as object), ai_graded: ai.info } : input.answer),
      graded.is_correct,
      graded.score,
      confidence,
      rating,
      input.duration_ms ?? null,
      now.toISOString(),
    )
    const state = rating === null ? null : refreshSchedule(db, item.id)
    return {
      attempt_id: attemptId,
      is_correct: graded.is_correct,
      score: graded.score,
      rating,
      confidently_wrong: isConfidentlyWrong(graded, confidence),
      feedback: ai?.info.feedback ?? null,
      ai_graded: Boolean(ai),
      due_at: state?.due_at ?? null,
      state: state?.state ?? null,
      resolvedTopics: [] as string[],
    }
  })
  result.resolvedTopics = resolveOverrides(db)
  return result
}

export function reviewsDue(db: Db, now = new Date()): number {
  return (
    get<{ n: number }>(
      db,
      `SELECT count(*) AS n FROM ${SCHEDULED_ITEMS} AND s.due_at <= ?`,
      now.toISOString(),
    )?.n ?? 0
  )
}

/** Every live scheduled item that is due, most overdue first. */
export function practiceQueue(db: Db, now = new Date()): PracticeData {
  const rows = all<
    ReviewItemStateRow & {
      block_id: string
      lesson_id: string
      lesson_title: string
      topic_id: string
      topic_title: string
    }
  >(
    db,
    `SELECT s.*, ri.block_id, l.id AS lesson_id, l.title AS lesson_title, t.id AS topic_id, t.title AS topic_title
     FROM ${SCHEDULED_ITEMS}
     ORDER BY s.due_at, ri.id`,
  )
  const versions = new Map<string, LessonVersionRow>()
  const due: PracticeItem[] = []
  let nextDueAt: string | null = null
  for (const r of rows) {
    if (r.due_at > now.toISOString()) {
      nextDueAt ??= r.due_at
      continue
    }
    if (!versions.has(r.lesson_id)) versions.set(r.lesson_id, latestVersion(db, r.lesson_id))
    const version = versions.get(r.lesson_id)!
    const block = versionBlocks(version).find((b) => b.id === r.block_id) as InteractiveBlock | undefined
    if (!block) continue
    due.push({
      review_item_id: r.review_item_id,
      lesson_id: r.lesson_id,
      lesson_title: r.lesson_title,
      topic_id: r.topic_id,
      topic_title: r.topic_title,
      lesson_version_id: version.id,
      block,
      state: r.state,
      due_at: r.due_at,
      lapses: r.lapses,
    })
  }
  return { due, nextDueAt }
}
