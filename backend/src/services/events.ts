import type { Actor, TopicEventType } from '../../../shared/domain'
import type { TopicEventView } from '../../../shared/api'
import { all, run, type Db } from '../db/connection'
import { newId, nowIso } from '../lib'

/** Who is making a change. Proposals pass their id so history links back to the suggestion. */
export interface Ctx {
  actor: Actor
  proposalId?: string | null
}
export const USER: Ctx = { actor: 'user' }
export const SYSTEM: Ctx = { actor: 'system' }

export function recordEvent(
  db: Db,
  ctx: Ctx,
  topicId: string,
  type: TopicEventType,
  from: string | null = null,
  to: string | null = null,
): void {
  run(
    db,
    `INSERT INTO topic_events (id, topic_id, event_type, from_value, to_value, actor, proposal_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    newId(),
    topicId,
    type,
    from,
    to,
    ctx.actor,
    ctx.proposalId ?? null,
    nowIso(),
  )
}

export function listEvents(db: Db, topicId: string): TopicEventView[] {
  return all<TopicEventView>(
    db,
    `SELECT id, event_type, from_value, to_value, actor, created_at
     FROM topic_events WHERE topic_id = ? ORDER BY created_at DESC, id DESC`,
    topicId,
  )
}
