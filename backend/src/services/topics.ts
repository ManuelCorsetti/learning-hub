import type { TopicStatus } from '../../../shared/domain'
import type { LinkView, TopicDetail, TopicListItem } from '../../../shared/api'
import { all, get, run, tx, type Db } from '../db/connection'
import { AppError, clean, conflict, newId, notFound, nowIso } from '../lib'
import { getArea, requireLiveArea } from './areas'
import { listEvents, recordEvent, type Ctx } from './events'
import { linkProblem, normaliseLink, type LinkRow } from './links'
import { measureTopics, statusInfo } from './status'

export interface TopicRow {
  id: string
  title: string
  summary: string | null
  why_i_care: string | null
  area_id: string | null
  status_override: TopicStatus | null
  status_override_note: string | null
  status_override_at: string | null
  merged_into_id: string | null
  archived_at: string | null
  created_at: string
  updated_at: string
}

export function getTopic(db: Db, id: string): TopicRow | undefined {
  return get<TopicRow>(db, 'SELECT * FROM topics WHERE id = ?', id)
}

export function requireLiveTopic(db: Db, id: string): TopicRow {
  const topic = getTopic(db, id)
  if (!topic) throw notFound('Topic')
  if (topic.archived_at) throw new AppError(`"${topic.title}" is archived`, 409)
  return topic
}

function assertTitleFree(db: Db, title: string, exceptId: string | null = null): void {
  const clash = get<{ id: string }>(
    db,
    'SELECT id FROM topics WHERE lower(title) = lower(?) AND archived_at IS NULL AND id IS NOT ?',
    title,
    exceptId,
  )
  if (clash) throw conflict(`A topic called "${title}" already exists`)
}

const areaLabel = (db: Db, areaId: string | null): string => (areaId ? (getArea(db, areaId)?.name ?? 'Unknown') : 'Inbox')

export function createTopic(
  db: Db,
  ctx: Ctx,
  input: { id?: string; title: string; summary?: string | null; why_i_care?: string | null; area_id?: string | null },
): TopicRow {
  return tx(db, () => {
    const title = input.title.trim()
    assertTitleFree(db, title)
    if (input.area_id) requireLiveArea(db, input.area_id)
    const id = input.id ?? newId()
    const now = nowIso()
    run(
      db,
      `INSERT INTO topics (id, title, summary, why_i_care, area_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id,
      title,
      clean(input.summary),
      clean(input.why_i_care),
      input.area_id ?? null,
      now,
      now,
    )
    recordEvent(db, ctx, id, 'created', null, title)
    return getTopic(db, id)!
  })
}

export function updateTopic(
  db: Db,
  ctx: Ctx,
  id: string,
  patch: { title?: string | null; summary?: string | null; why_i_care?: string | null; area_id?: string | null },
): TopicRow {
  return tx(db, () => {
    const topic = requireLiveTopic(db, id)
    const title = patch.title?.trim() || topic.title
    if (title !== topic.title) {
      if (title.toLowerCase() !== topic.title.toLowerCase()) assertTitleFree(db, title, id)
      recordEvent(db, ctx, id, 'renamed', topic.title, title)
    }
    let areaId = topic.area_id
    if (patch.area_id !== undefined && patch.area_id !== topic.area_id) {
      if (patch.area_id) requireLiveArea(db, patch.area_id)
      recordEvent(db, ctx, id, 'area_changed', areaLabel(db, topic.area_id), areaLabel(db, patch.area_id))
      areaId = patch.area_id
    }
    run(
      db,
      'UPDATE topics SET title = ?, summary = ?, why_i_care = ?, area_id = ?, updated_at = ? WHERE id = ?',
      title,
      patch.summary === undefined ? topic.summary : clean(patch.summary),
      patch.why_i_care === undefined ? topic.why_i_care : clean(patch.why_i_care),
      areaId,
      nowIso(),
      id,
    )
    return getTopic(db, id)!
  })
}

/**
 * Sets the status the user wants to see. Choosing the measured status clears the
 * override; anything else becomes an override. The measured mastery is never changed.
 */
export function setStatus(db: Db, ctx: Ctx, id: string, status: TopicStatus, note?: string | null): TopicRow {
  return tx(db, () => {
    const topic = requireLiveTopic(db, id)
    const derived = measureTopics(db, [id]).get(id)!.derived
    if (status === derived) {
      if (topic.status_override) {
        run(
          db,
          `UPDATE topics SET status_override = NULL, status_override_note = NULL, status_override_at = NULL,
           updated_at = ? WHERE id = ?`,
          nowIso(),
          id,
        )
        recordEvent(db, ctx, id, 'status_override_cleared', topic.status_override, null)
      }
    } else if (status !== topic.status_override || clean(note) !== topic.status_override_note) {
      const now = nowIso()
      run(
        db,
        `UPDATE topics SET status_override = ?, status_override_note = ?, status_override_at = ?, updated_at = ?
         WHERE id = ?`,
        status,
        clean(note),
        now,
        now,
        id,
      )
      recordEvent(db, ctx, id, 'status_override_set', topic.status_override, status)
    }
    return getTopic(db, id)!
  })
}

/** Clears overrides that measurement has caught up with. Returns the topics resolved. */
export function resolveOverrides(db: Db): string[] {
  const overridden = all<TopicRow>(db, 'SELECT * FROM topics WHERE status_override IS NOT NULL AND archived_at IS NULL')
  if (!overridden.length) return []
  const measured = measureTopics(
    db,
    overridden.map((t) => t.id),
  )
  const resolved = overridden.filter((t) => measured.get(t.id)!.derived === t.status_override)
  tx(db, () => {
    for (const t of resolved) {
      run(
        db,
        `UPDATE topics SET status_override = NULL, status_override_note = NULL, status_override_at = NULL,
         updated_at = ? WHERE id = ?`,
        nowIso(),
        t.id,
      )
      recordEvent(db, { actor: 'system' }, t.id, 'status_override_resolved', t.status_override, null)
    }
  })
  return resolved.map((t) => t.id)
}

export function archiveTopic(db: Db, ctx: Ctx, id: string): TopicRow {
  return tx(db, () => {
    requireLiveTopic(db, id)
    run(db, 'UPDATE topics SET archived_at = ?, updated_at = ? WHERE id = ?', nowIso(), nowIso(), id)
    recordEvent(db, ctx, id, 'archived')
    return getTopic(db, id)!
  })
}

export function restoreTopic(db: Db, ctx: Ctx, id: string): TopicRow {
  return tx(db, () => {
    const topic = getTopic(db, id)
    if (!topic) throw notFound('Topic')
    if (!topic.archived_at) return topic
    if (topic.merged_into_id) throw conflict('A merged topic cannot be restored')
    assertTitleFree(db, topic.title, id)
    const areaId = topic.area_id && !getArea(db, topic.area_id)?.archived_at ? topic.area_id : null
    run(db, 'UPDATE topics SET archived_at = NULL, area_id = ?, updated_at = ? WHERE id = ?', areaId, nowIso(), id)
    recordEvent(db, ctx, id, 'restored')
    return getTopic(db, id)!
  })
}

/**
 * Merges `mergeId` into `keepId`: links, goals and resources move to the kept topic,
 * and the merged topic is archived with merged_into_id. Links that would become
 * duplicates, self-links or loops are dropped.
 */
export function mergeTopics(db: Db, ctx: Ctx, keepId: string, mergeId: string): TopicRow {
  if (keepId === mergeId) throw new AppError('Choose two different topics to merge')
  return tx(db, () => {
    const keep = requireLiveTopic(db, keepId)
    const merged = requireLiveTopic(db, mergeId)

    const links = all<LinkRow>(db, 'SELECT * FROM topic_links WHERE from_topic_id = ? OR to_topic_id = ?', mergeId, mergeId)
    run(db, 'DELETE FROM topic_links WHERE from_topic_id = ? OR to_topic_id = ?', mergeId, mergeId)
    for (const link of links) {
      const from = link.from_topic_id === mergeId ? keepId : link.from_topic_id
      const to = link.to_topic_id === mergeId ? keepId : link.to_topic_id
      if (linkProblem(db, from, to, link.link_type)) continue
      const [f, t] = normaliseLink(from, to, link.link_type)
      run(
        db,
        `INSERT INTO topic_links (id, from_topic_id, to_topic_id, link_type, rationale, source_proposal_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        link.id,
        f,
        t,
        link.link_type,
        link.rationale,
        link.source_proposal_id,
        link.created_at,
      )
    }

    run(
      db,
      `INSERT OR IGNORE INTO topic_goals (topic_id, goal_id, created_at)
       SELECT ?, goal_id, created_at FROM topic_goals WHERE topic_id = ?`,
      keepId,
      mergeId,
    )
    run(db, 'DELETE FROM topic_goals WHERE topic_id = ?', mergeId)
    run(db, 'UPDATE resources SET topic_id = ? WHERE topic_id = ?', keepId, mergeId)

    const now = nowIso()
    run(db, 'UPDATE topics SET merged_into_id = ?, archived_at = ?, updated_at = ? WHERE id = ?', keepId, now, now, mergeId)
    run(
      db,
      'UPDATE topics SET summary = coalesce(summary, ?), why_i_care = coalesce(why_i_care, ?), updated_at = ? WHERE id = ?',
      merged.summary,
      merged.why_i_care,
      now,
      keepId,
    )
    recordEvent(db, ctx, mergeId, 'merged', merged.title, keep.title)
    recordEvent(db, ctx, keepId, 'merged', merged.title, keep.title)
    return getTopic(db, keepId)!
  })
}

export function toListItems(db: Db, rows: TopicRow[]): TopicListItem[] {
  const measured = measureTopics(
    db,
    rows.map((r) => r.id),
  )
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    summary: r.summary,
    area_id: r.area_id,
    status: statusInfo(r.status_override, r.status_override_note, measured.get(r.id)!),
    created_at: r.created_at,
  }))
}

/** areaId: an area id, null for the inbox, or undefined for every live topic. */
export function listTopics(db: Db, areaId?: string | null): TopicListItem[] {
  const rows =
    areaId === undefined
      ? all<TopicRow>(db, 'SELECT * FROM topics WHERE archived_at IS NULL ORDER BY lower(title)')
      : all<TopicRow>(
          db,
          'SELECT * FROM topics WHERE archived_at IS NULL AND area_id IS ? ORDER BY lower(title)',
          areaId,
        )
  return toListItems(db, rows)
}

export function getTopicDetail(db: Db, id: string): TopicDetail {
  const row = getTopic(db, id)
  if (!row) throw notFound('Topic')
  const [item] = toListItems(db, [row])
  const area = row.area_id ? getArea(db, row.area_id) : undefined

  const links = all<LinkRow & { other_id: string; other_title: string; other_area: string | null }>(
    db,
    `SELECT l.*, o.id AS other_id, o.title AS other_title, o.area_id AS other_area
     FROM topic_links l
     JOIN topics o ON o.id = CASE WHEN l.from_topic_id = ? THEN l.to_topic_id ELSE l.from_topic_id END
     WHERE (l.from_topic_id = ? OR l.to_topic_id = ?) AND o.archived_at IS NULL
     ORDER BY l.link_type, lower(o.title)`,
    id,
    id,
    id,
  ).map<LinkView>((l) => ({
    id: l.id,
    from_topic_id: l.from_topic_id,
    to_topic_id: l.to_topic_id,
    link_type: l.link_type,
    rationale: l.rationale,
    other: { id: l.other_id, title: l.other_title, area_id: l.other_area },
    direction: l.from_topic_id === id ? 'out' : 'in',
  }))

  return {
    ...item,
    why_i_care: row.why_i_care,
    area: area ? { id: area.id, name: area.name } : null,
    archived_at: row.archived_at,
    merged_into_id: row.merged_into_id,
    links,
    goals: all(
      db,
      `SELECT g.id, g.title, g.status FROM topic_goals tg JOIN goals g ON g.id = tg.goal_id
       WHERE tg.topic_id = ? ORDER BY lower(g.title)`,
      id,
    ),
    resources: all(
      db,
      `SELECT id, kind, title, url, note, created_at FROM resources
       WHERE topic_id = ? AND archived_at IS NULL ORDER BY created_at`,
      id,
    ),
    events: listEvents(db, id),
  }
}
