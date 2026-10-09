import type { LinkType } from '../../../shared/domain'
import { all, get, run, tx, type Db } from '../db/connection'
import { AppError, clean, newId, notFound, nowIso } from '../lib'
import { recordEvent, USER, type Ctx } from './events'

export interface LinkRow {
  id: string
  from_topic_id: string
  to_topic_id: string
  link_type: LinkType
  rationale: string | null
  source_proposal_id: string | null
  created_at: string
}

export type Edge = [from: string, to: string]

/** related_to is symmetric and stored once, with the smaller id first. */
export function normaliseLink(from: string, to: string, type: LinkType): Edge {
  return type === 'related_to' && from > to ? [to, from] : [from, to]
}

/** Prerequisite edges between live topics. */
export function prerequisiteEdges(db: Db): Edge[] {
  return all<{ f: string; t: string }>(
    db,
    `SELECT l.from_topic_id AS f, l.to_topic_id AS t FROM topic_links l
     JOIN topics a ON a.id = l.from_topic_id AND a.archived_at IS NULL
     JOIN topics b ON b.id = l.to_topic_id AND b.archived_at IS NULL
     WHERE l.link_type = 'prerequisite_of'`,
  ).map((r) => [r.f, r.t])
}

/** [sub-topic, parent] pairs between live topics. */
export function parentEdges(db: Db): Edge[] {
  return all<{ f: string; t: string }>(
    db,
    `SELECT l.from_topic_id AS f, l.to_topic_id AS t FROM topic_links l
     JOIN topics a ON a.id = l.from_topic_id AND a.archived_at IS NULL
     JOIN topics b ON b.id = l.to_topic_id AND b.archived_at IS NULL
     WHERE l.link_type = 'part_of'`,
  ).map((r) => [r.f, r.t])
}

/**
 * Why `child` cannot become part of `parent`, or null. The map is area › topic › sub-topic,
 * so a parent cannot itself be a sub-topic and a sub-topic cannot have sub-topics. That
 * also rules out part_of loops.
 */
export function parentProblem(parents: Edge[], child: string, parent: string): string | null {
  if (parents.some(([c]) => c === child)) return 'A topic can be part of only one parent topic'
  if (parents.some(([c]) => c === parent)) return 'The parent is itself a sub-topic; sub-topics go only one level deep'
  if (parents.some(([, p]) => p === child)) return 'This topic has sub-topics of its own, so it cannot become a sub-topic'
  return null
}

/** True if adding from → to would close a loop, i.e. `to` already leads to `from`. */
export function wouldCreateCycle(edges: Edge[], from: string, to: string): boolean {
  const next = new Map<string, string[]>()
  for (const [f, t] of edges) next.set(f, [...(next.get(f) ?? []), t])
  const stack = [to]
  const seen = new Set<string>()
  while (stack.length) {
    const node = stack.pop()!
    if (node === from) return true
    if (seen.has(node)) continue
    seen.add(node)
    stack.push(...(next.get(node) ?? []))
  }
  return false
}

/**
 * Returns why a link cannot be added, or null if it can.
 * `extraPrereqs` and `extraParents` let callers check a batch of proposed links together.
 */
export function linkProblem(
  db: Db,
  fromId: string,
  toId: string,
  type: LinkType,
  extraPrereqs: Edge[] = [],
  extraParents: Edge[] = [],
): string | null {
  if (fromId === toId) return 'A topic cannot link to itself'
  const live = all<{ id: string }>(
    db,
    'SELECT id FROM topics WHERE id IN (?, ?) AND archived_at IS NULL',
    fromId,
    toId,
  )
  if (live.length !== 2) return 'Both topics must exist and not be archived'
  const [from, to] = normaliseLink(fromId, toId, type)
  if (get(db, 'SELECT 1 FROM topic_links WHERE from_topic_id = ? AND to_topic_id = ? AND link_type = ?', from, to, type)) {
    return 'That link already exists'
  }
  if (type === 'part_of') {
    const problem = parentProblem([...parentEdges(db), ...extraParents], from, to)
    if (problem) return problem
  }
  if (type === 'prerequisite_of' && wouldCreateCycle([...prerequisiteEdges(db), ...extraPrereqs], from, to)) {
    return 'That prerequisite would create a loop'
  }
  return null
}

export function createLink(
  db: Db,
  input: {
    id?: string
    from_topic_id: string
    to_topic_id: string
    link_type: LinkType
    rationale?: string | null
    source_proposal_id?: string | null
  },
  ctx: Ctx = USER,
): string {
  return tx(db, () => {
    const problem = linkProblem(db, input.from_topic_id, input.to_topic_id, input.link_type)
    if (problem) throw new AppError(problem, 409)
    const [from, to] = normaliseLink(input.from_topic_id, input.to_topic_id, input.link_type)
    const id = input.id ?? newId()
    run(
      db,
      `INSERT INTO topic_links (id, from_topic_id, to_topic_id, link_type, rationale, source_proposal_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id,
      from,
      to,
      input.link_type,
      clean(input.rationale),
      input.source_proposal_id ?? null,
      nowIso(),
    )
    if (input.link_type === 'part_of') followParentArea(db, ctx, from, to)
    return id
  })
}

/** A sub-topic lives in its parent's area, so the breadcrumb is always area › topic › sub-topic. */
function followParentArea(db: Db, ctx: Ctx, childId: string, parentId: string): void {
  const rows = all<{ id: string; area_id: string | null; area_name: string | null }>(
    db,
    'SELECT t.id, t.area_id, a.name AS area_name FROM topics t LEFT JOIN areas a ON a.id = t.area_id WHERE t.id IN (?, ?)',
    childId,
    parentId,
  )
  const child = rows.find((r) => r.id === childId)!
  const parent = rows.find((r) => r.id === parentId)!
  if (child.area_id === parent.area_id) return
  run(db, 'UPDATE topics SET area_id = ?, updated_at = ? WHERE id = ?', parent.area_id, nowIso(), childId)
  recordEvent(db, ctx, childId, 'area_changed', child.area_name ?? 'Inbox', parent.area_name ?? 'Inbox')
}

export function getLink(db: Db, id: string): LinkRow | undefined {
  return get<LinkRow>(db, 'SELECT * FROM topic_links WHERE id = ?', id)
}

/** Links are hard-deleted; the history lives in the proposal or the topic events. */
export function removeLink(db: Db, id: string): LinkRow {
  const link = getLink(db, id)
  if (!link) throw notFound('Link')
  run(db, 'DELETE FROM topic_links WHERE id = ?', id)
  return link
}
