import type { z } from 'zod'
import type { CreateGoalInput, CreateResourceInput, GoalView, UpdateGoalInput } from '../../../shared/api'
import { all, get, run, type Db } from '../db/connection'
import { clean, newId, notFound, nowIso } from '../lib'
import { requireLiveTopic } from './topics'

interface GoalRow {
  id: string
  title: string
  description: string | null
  target_date: string | null
  status: GoalView['status']
}

export function listGoals(db: Db): GoalView[] {
  const goals = all<GoalRow>(
    db,
    `SELECT id, title, description, target_date, status FROM goals
     ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, target_date IS NULL, target_date, lower(title)`,
  )
  const links = all<{ goal_id: string; id: string; title: string }>(
    db,
    `SELECT tg.goal_id, t.id, t.title FROM topic_goals tg JOIN topics t ON t.id = tg.topic_id
     WHERE t.archived_at IS NULL ORDER BY lower(t.title)`,
  )
  return goals.map((g) => ({
    ...g,
    topics: links.filter((l) => l.goal_id === g.id).map(({ id, title }) => ({ id, title })),
  }))
}

function requireGoal(db: Db, id: string): GoalRow {
  const goal = get<GoalRow>(db, 'SELECT id, title, description, target_date, status FROM goals WHERE id = ?', id)
  if (!goal) throw notFound('Goal')
  return goal
}

export function createGoal(db: Db, input: z.infer<typeof CreateGoalInput>): string {
  const id = newId()
  const now = nowIso()
  run(
    db,
    `INSERT INTO goals (id, title, description, target_date, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?)`,
    id,
    input.title.trim(),
    clean(input.description),
    input.target_date ?? null,
    now,
    now,
  )
  return id
}

export function updateGoal(db: Db, id: string, patch: z.infer<typeof UpdateGoalInput>): void {
  const goal = requireGoal(db, id)
  run(
    db,
    'UPDATE goals SET title = ?, description = ?, target_date = ?, status = ?, updated_at = ? WHERE id = ?',
    patch.title?.trim() ?? goal.title,
    patch.description === undefined ? goal.description : clean(patch.description),
    patch.target_date === undefined ? goal.target_date : patch.target_date,
    patch.status ?? goal.status,
    nowIso(),
    id,
  )
}

export function linkGoal(db: Db, topicId: string, goalId: string): void {
  requireLiveTopic(db, topicId)
  requireGoal(db, goalId)
  run(db, 'INSERT OR IGNORE INTO topic_goals (topic_id, goal_id, created_at) VALUES (?, ?, ?)', topicId, goalId, nowIso())
}

export function unlinkGoal(db: Db, topicId: string, goalId: string): void {
  run(db, 'DELETE FROM topic_goals WHERE topic_id = ? AND goal_id = ?', topicId, goalId)
}

export function addResource(db: Db, topicId: string, input: z.infer<typeof CreateResourceInput>): string {
  requireLiveTopic(db, topicId)
  const id = newId()
  run(
    db,
    `INSERT INTO resources (id, topic_id, kind, title, url, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id,
    topicId,
    input.kind,
    input.title.trim(),
    clean(input.url),
    clean(input.note),
    nowIso(),
  )
  return id
}

export function archiveResource(db: Db, id: string): void {
  if (!run(db, 'UPDATE resources SET archived_at = ? WHERE id = ? AND archived_at IS NULL', nowIso(), id)) {
    throw notFound('Resource')
  }
}
