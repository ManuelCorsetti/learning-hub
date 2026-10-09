// The conversation behind Build lesson: level, brief, the planner's questions and your answers.
// Kept with the lesson it produced, so you can see what a lesson was built from.
import type { LessonLevel, LessonRequestStatus } from '../../../shared/domain'
import type { LessonPlan, LessonRequestMessage, LessonRequestView } from '../../../shared/api'
import { get, run, type Db } from '../db/connection'
import { AppError, clean, newId, notFound, nowIso } from '../lib'
import { requireLiveTopic } from './topics'

interface LessonRequestRow {
  id: string
  topic_id: string
  level: LessonLevel | null
  brief: string | null
  messages_json: string
  plan_json: string | null
  status: LessonRequestStatus
  lesson_id: string | null
}

const toView = (r: LessonRequestRow): LessonRequestView => ({
  id: r.id,
  topic_id: r.topic_id,
  level: r.level,
  brief: r.brief,
  status: r.status,
  lesson_id: r.lesson_id,
  messages: JSON.parse(r.messages_json) as LessonRequestMessage[],
  plan: r.plan_json ? (JSON.parse(r.plan_json) as LessonPlan) : null,
})

export function createLessonRequest(
  db: Db,
  topicId: string,
  input: { level?: LessonLevel | null; brief?: string | null },
): LessonRequestView {
  requireLiveTopic(db, topicId)
  const id = newId()
  const now = nowIso()
  run(
    db,
    `INSERT INTO lesson_requests (id, topic_id, level, brief, messages_json, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, '[]', 'open', ?, ?)`,
    id,
    topicId,
    input.level ?? null,
    clean(input.brief),
    now,
    now,
  )
  return getLessonRequest(db, id)
}

export function getLessonRequest(db: Db, id: string): LessonRequestView {
  const row = get<LessonRequestRow>(db, 'SELECT * FROM lesson_requests WHERE id = ?', id)
  if (!row) throw notFound('Lesson request')
  return toView(row)
}

export function requireOpenRequest(db: Db, id: string): LessonRequestView {
  const request = getLessonRequest(db, id)
  if (request.status !== 'open') throw new AppError('This lesson has already been built', 409)
  return request
}

export function appendMessages(db: Db, id: string, messages: LessonRequestMessage[], plan?: LessonPlan | null): LessonRequestView {
  const request = getLessonRequest(db, id)
  run(
    db,
    'UPDATE lesson_requests SET messages_json = ?, plan_json = coalesce(?, plan_json), updated_at = ? WHERE id = ?',
    JSON.stringify([...request.messages, ...messages]),
    plan ? JSON.stringify(plan) : null,
    nowIso(),
    id,
  )
  return getLessonRequest(db, id)
}

export function markBuilt(db: Db, id: string, lessonId: string): void {
  run(db, "UPDATE lesson_requests SET status = 'built', lesson_id = ?, updated_at = ? WHERE id = ?", lessonId, nowIso(), id)
}
