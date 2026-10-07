import type { LinkType } from '../../../shared/domain'
import { all, get, run, type Db } from '../db/connection'
import { AppError, clean, newId, notFound, nowIso } from '../lib'

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
 * `extraPrereqs` lets callers check a batch of proposed links together.
 */
export function linkProblem(
  db: Db,
  fromId: string,
  toId: string,
  type: LinkType,
  extraPrereqs: Edge[] = [],
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
  if (type === 'part_of' && get(db, "SELECT 1 FROM topic_links WHERE from_topic_id = ? AND link_type = 'part_of'", from)) {
    return 'A topic can be part of only one parent topic'
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
): string {
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
  return id
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
