// Co-authoring: one thread of notes and replies per lesson. Claude's suggested edits are
// lesson_patch proposals, so nothing changes until you accept one.
import type { ChatRole } from '../../../shared/domain'
import type { ChatMessageView, LessonPatchView } from '../../../shared/api'
import type { ProposalPayload } from '../../../shared/proposals'
import { all, get, run, type Db } from '../db/connection'
import { newId, notFound, nowIso } from '../lib'
import { describePatch } from './lessonPatch'
import { latestVersion, versionBlocks, type LessonVersionRow } from './lessons'

interface MessageRow {
  id: string
  thread_id: string
  role: ChatRole
  content: string
  block_id: string | null
  proposal_id: string | null
  ai_run_id: string | null
  created_at: string
}

export function threadFor(db: Db, lessonId: string): string {
  const existing = get<{ id: string }>(
    db,
    'SELECT id FROM chat_threads WHERE lesson_id = ? AND archived_at IS NULL ORDER BY created_at LIMIT 1',
    lessonId,
  )
  if (existing) return existing.id
  const id = newId()
  run(db, 'INSERT INTO chat_threads (id, lesson_id, created_at) VALUES (?, ?, ?)', id, lessonId, nowIso())
  return id
}

export function addMessage(
  db: Db,
  lessonId: string,
  message: { role: ChatRole; content: string; block_id?: string | null; proposal_id?: string | null; ai_run_id?: string | null },
): string {
  const id = newId()
  run(
    db,
    `INSERT INTO chat_messages (id, thread_id, role, content, block_id, proposal_id, ai_run_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    threadFor(db, lessonId),
    message.role,
    message.content,
    message.block_id ?? null,
    message.proposal_id ?? null,
    message.ai_run_id ?? null,
    nowIso(),
  )
  return id
}

function messageRows(db: Db, lessonId: string): MessageRow[] {
  return all<MessageRow>(
    db,
    `SELECT m.* FROM chat_messages m JOIN chat_threads t ON t.id = m.thread_id
     WHERE t.lesson_id = ? ORDER BY m.created_at, m.id`,
    lessonId,
  )
}

export function lessonPatchView(db: Db, proposalId: string): LessonPatchView {
  const row = get<{ id: string; status: LessonPatchView['status']; payload_json: string; decision_note: string | null }>(
    db,
    "SELECT id, status, payload_json, decision_note FROM proposals WHERE id = ? AND kind = 'lesson_patch'",
    proposalId,
  )
  if (!row) throw notFound('Lesson edit')
  const payload = JSON.parse(row.payload_json) as ProposalPayload<'lesson_patch'>
  const base = get<LessonVersionRow>(db, 'SELECT * FROM lesson_versions WHERE id = ?', payload.base_version_id)!
  return {
    proposal_id: row.id,
    status: row.status,
    change_note: payload.change_note,
    base_version_no: base.version_no,
    stale: latestVersion(db, payload.lesson_id).id !== base.id,
    changes: describePatch(versionBlocks(base), payload.ops),
    decision_note: row.decision_note,
  }
}

export function listMessages(db: Db, lessonId: string): ChatMessageView[] {
  return messageRows(db, lessonId).map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    block_id: m.block_id,
    created_at: m.created_at,
    patch: m.proposal_id ? lessonPatchView(db, m.proposal_id) : null,
  }))
}

/** An older suggested edit for the same lesson is replaced by the newest one. */
export function supersedeLessonPatches(db: Db, lessonId: string, exceptId: string): number {
  return run(
    db,
    `UPDATE proposals SET status = 'superseded', decided_at = ?, decision_note = 'Replaced by a newer suggestion'
     WHERE kind = 'lesson_patch' AND status = 'pending' AND target_id = ? AND id <> ?`,
    nowIso(),
    lessonId,
    exceptId,
  )
}

/** Your notes on a topic's lessons, newest first, so new lessons for the topic take them into account. */
export function topicNotes(db: Db, topicId: string, limit = 20): { lesson: string; note: string }[] {
  return all<{ lesson: string; note: string }>(
    db,
    `SELECT l.title AS lesson, m.content AS note FROM chat_messages m
     JOIN chat_threads t ON t.id = m.thread_id
     JOIN lessons l ON l.id = t.lesson_id
     WHERE l.topic_id = ? AND m.role = 'user' ORDER BY m.created_at DESC LIMIT ?`,
    topicId,
    limit,
  )
}
