// AI proposes, the user decides. Every AI-driven change is a proposal until accepted.
import type { AiTask, ProposalKind, ProposalStatus } from '../../../shared/domain'
import { LINK_TYPE_LABELS } from '../../../shared/domain'
import type { AcceptResult, ProposalGroup, ProposalView } from '../../../shared/api'
import { PAYLOAD_VERSION, ProposalPayloads, type ProposalDraft, type ProposalPayload } from '../../../shared/proposals'
import { all, get, run, tx, type Db } from '../db/connection'
import { AppError, conflict, notFound, nowIso } from '../lib'
import { createArea, getArea, updateArea } from './areas'
import type { Ctx } from './events'
import { applyPatch } from './lessonPatch'
import { addVersion, getLesson, latestVersion, versionBlocks } from './lessons'
import { createLink, getLink, removeLink } from './links'
import { archiveTopic, createTopic, getTopic, mergeTopics, updateTopic } from './topics'

export interface ProposalRow {
  id: string
  ai_run_id: string | null
  kind: ProposalKind
  target_type: string | null
  target_id: string | null
  area_id: string | null
  topic_id: string | null
  payload_json: string
  payload_version: number
  rationale: string | null
  depends_on_id: string | null
  status: ProposalStatus
  decided_at: string | null
  decision_note: string | null
  applied_entity_id: string | null
  created_at: string
}

function payloadOf<K extends ProposalKind>(row: ProposalRow & { kind: K }): ProposalPayload<K> {
  return ProposalPayloads[row.kind].parse(JSON.parse(row.payload_json)) as ProposalPayload<K>
}

const liveAreaId = (db: Db, id: string | null | undefined) => (id && getArea(db, id) ? id : null)
const topicAreaId = (db: Db, id: string) => getTopic(db, id)?.area_id ?? null
const existingTopicId = (db: Db, id: string) => (getTopic(db, id) ? id : null)

/** Which existing area/topic a proposal concerns, so the UI can show "N suggestions" per area. */
function scopeOf(
  db: Db,
  d: ProposalDraft,
): { target_type: string | null; target_id: string | null; area_id: string | null; topic_id: string | null } {
  switch (d.kind) {
    case 'create_area':
      return { target_type: 'area', target_id: null, area_id: null, topic_id: null }
    case 'update_area':
      return { target_type: 'area', target_id: d.payload.area_id, area_id: liveAreaId(db, d.payload.area_id), topic_id: null }
    case 'create_topic':
      return { target_type: 'topic', target_id: null, area_id: liveAreaId(db, d.payload.area_id), topic_id: null }
    case 'update_topic':
    case 'move_topic':
    case 'archive_topic': {
      const id = d.payload.topic_id
      return { target_type: 'topic', target_id: id, area_id: liveAreaId(db, topicAreaId(db, id)), topic_id: existingTopicId(db, id) }
    }
    case 'merge_topics': {
      const keep = d.payload.keep_topic_id
      return {
        target_type: 'topic',
        target_id: d.payload.merge_topic_id,
        area_id: liveAreaId(db, topicAreaId(db, keep)),
        topic_id: existingTopicId(db, keep),
      }
    }
    case 'create_link': {
      const from = d.payload.from_topic_id
      return { target_type: 'topic_link', target_id: null, area_id: liveAreaId(db, topicAreaId(db, from)), topic_id: existingTopicId(db, from) }
    }
    case 'lesson_patch': {
      const topicId = getLesson(db, d.payload.lesson_id)?.topic_id ?? null
      return {
        target_type: 'lesson',
        target_id: d.payload.lesson_id,
        area_id: topicId ? liveAreaId(db, topicAreaId(db, topicId)) : null,
        topic_id: topicId ? existingTopicId(db, topicId) : null,
      }
    }
    case 'remove_link': {
      const from = getLink(db, d.payload.link_id)?.from_topic_id
      return {
        target_type: 'topic_link',
        target_id: d.payload.link_id,
        area_id: from ? liveAreaId(db, topicAreaId(db, from)) : null,
        topic_id: from ? existingTopicId(db, from) : null,
      }
    }
  }
}

export function createProposals(db: Db, aiRunId: string | null, drafts: ProposalDraft[]): string[] {
  return tx(db, () => {
    const now = nowIso()
    for (const d of drafts) {
      ProposalPayloads[d.kind].parse(d.payload)
      const scope = scopeOf(db, d)
      run(
        db,
        `INSERT INTO proposals (id, ai_run_id, kind, target_type, target_id, area_id, topic_id, payload_json,
           payload_version, rationale, depends_on_id, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
        d.id,
        aiRunId,
        d.kind,
        scope.target_type,
        scope.target_id,
        scope.area_id,
        scope.topic_id,
        JSON.stringify(d.payload),
        PAYLOAD_VERSION,
        d.rationale,
        d.depends_on_id ?? null,
        now,
      )
    }
    return drafts.map((d) => d.id)
  })
}

function requireProposal(db: Db, id: string): ProposalRow {
  const row = get<ProposalRow>(db, 'SELECT * FROM proposals WHERE id = ?', id)
  if (!row) throw notFound('Suggestion')
  return row
}

function decide(db: Db, id: string, status: ProposalStatus, note: string | null, appliedId: string | null = null): void {
  run(
    db,
    'UPDATE proposals SET status = ?, decided_at = ?, decision_note = ?, applied_entity_id = ? WHERE id = ?',
    status,
    nowIso(),
    note,
    appliedId,
    id,
  )
}

/** Applies an accepted proposal to the map. Returns the id of the entity it created or changed. */
function apply(db: Db, row: ProposalRow): string {
  const ctx: Ctx = { actor: 'proposal', proposalId: row.id }
  switch (row.kind) {
    case 'create_area': {
      const p = payloadOf({ ...row, kind: 'create_area' })
      return createArea(db, { id: p.id, name: p.name, summary: p.summary }).id
    }
    case 'update_area': {
      const p = payloadOf({ ...row, kind: 'update_area' })
      updateArea(db, p.area_id, { name: p.name ?? undefined, summary: p.summary ?? undefined })
      return p.area_id
    }
    case 'create_topic': {
      const p = payloadOf({ ...row, kind: 'create_topic' })
      const topic = createTopic(db, ctx, p)
      if (p.parent_topic_id) {
        createLink(db, { from_topic_id: topic.id, to_topic_id: p.parent_topic_id, link_type: 'part_of' }, ctx)
      }
      return topic.id
    }
    case 'update_topic': {
      const p = payloadOf({ ...row, kind: 'update_topic' })
      updateTopic(db, ctx, p.topic_id, {
        title: p.title ?? undefined,
        summary: p.summary ?? undefined,
        why_i_care: p.why_i_care ?? undefined,
      })
      return p.topic_id
    }
    case 'move_topic': {
      const p = payloadOf({ ...row, kind: 'move_topic' })
      updateTopic(db, ctx, p.topic_id, { area_id: p.area_id })
      return p.topic_id
    }
    case 'merge_topics': {
      const p = payloadOf({ ...row, kind: 'merge_topics' })
      return mergeTopics(db, ctx, p.keep_topic_id, p.merge_topic_id).id
    }
    case 'archive_topic': {
      const p = payloadOf({ ...row, kind: 'archive_topic' })
      return archiveTopic(db, ctx, p.topic_id).id
    }
    case 'create_link': {
      const p = payloadOf({ ...row, kind: 'create_link' })
      return createLink(db, { ...p, rationale: row.rationale, source_proposal_id: row.id }, ctx)
    }
    case 'remove_link': {
      const p = payloadOf({ ...row, kind: 'remove_link' })
      return removeLink(db, p.link_id).id
    }
    case 'lesson_patch': {
      const p = payloadOf({ ...row, kind: 'lesson_patch' })
      const latest = latestVersion(db, p.lesson_id)
      if (latest.id !== p.base_version_id) {
        throw conflict('The lesson has changed since this edit was suggested. Ask for it again.')
      }
      const { blocks, problems } = applyPatch(versionBlocks(latest), p.ops)
      if (problems.length) throw new AppError(problems.join('; '))
      return addVersion(db, p.lesson_id, {
        blocks,
        createdBy: 'ai',
        changeNote: p.change_note,
        basedOnVersionId: latest.id,
        sourceProposalId: row.id,
        aiRunId: row.ai_run_id,
      })
    }
  }
}

export function acceptProposal(db: Db, id: string): AcceptResult {
  const row = requireProposal(db, id)
  if (row.status !== 'pending') throw conflict('This suggestion has already been decided')
  if (row.depends_on_id) {
    const dep = requireProposal(db, row.depends_on_id)
    if (dep.status === 'pending') throw conflict(`Accept "${describe(db, dep).description}" first`)
    if (dep.status !== 'accepted') {
      decide(db, id, 'failed', 'The suggestion it depends on was not accepted')
      return result(db, id)
    }
  }
  try {
    tx(db, () => {
      const appliedId = apply(db, row)
      decide(db, id, 'accepted', null, appliedId)
    })
  } catch (err) {
    decide(db, id, 'failed', err instanceof Error ? err.message : String(err))
  }
  return result(db, id)
}

function result(db: Db, id: string): AcceptResult {
  const row = requireProposal(db, id)
  return { id, status: row.status, decision_note: row.decision_note }
}

/** Accepts several proposals, dependencies first. One failure does not undo the others. */
export function acceptMany(db: Db, ids: string[]): AcceptResult[] {
  const rows = ids.map((id) => requireProposal(db, id)).filter((r) => r.status === 'pending')
  const byId = new Map(rows.map((r) => [r.id, r]))
  const ordered: ProposalRow[] = []
  const visit = (r: ProposalRow, seen = new Set<string>()) => {
    if (ordered.includes(r) || seen.has(r.id)) return
    seen.add(r.id)
    const dep = r.depends_on_id ? byId.get(r.depends_on_id) : undefined
    if (dep) visit(dep, seen)
    ordered.push(r)
  }
  rows.forEach((r) => visit(r))
  return ordered.map((r) => {
    try {
      return acceptProposal(db, r.id)
    } catch (err) {
      if (err instanceof AppError) return { id: r.id, status: 'pending' as const, decision_note: err.message }
      throw err
    }
  })
}

export function acceptRun(db: Db, aiRunId: string): AcceptResult[] {
  const ids = all<{ id: string }>(
    db,
    "SELECT id FROM proposals WHERE ai_run_id = ? AND status = 'pending' ORDER BY created_at, id",
    aiRunId,
  ).map((r) => r.id)
  return acceptMany(db, ids)
}

/** Rejects a proposal and any pending proposals that depend on it. */
export function rejectProposal(db: Db, id: string, note: string | null = null): void {
  tx(db, () => {
    const row = requireProposal(db, id)
    if (row.status !== 'pending') throw conflict('This suggestion has already been decided')
    decide(db, id, 'rejected', note)
    const dependants = all<{ id: string }>(
      db,
      "SELECT id FROM proposals WHERE depends_on_id = ? AND status = 'pending'",
      id,
    )
    for (const d of dependants) rejectDependant(db, d.id)
  })
}

function rejectDependant(db: Db, id: string): void {
  decide(db, id, 'rejected', 'Depends on a rejected suggestion')
  for (const d of all<{ id: string }>(db, "SELECT id FROM proposals WHERE depends_on_id = ? AND status = 'pending'", id)) {
    rejectDependant(db, d.id)
  }
}

/** Marks pending proposals from earlier runs of a task as superseded by a new run. */
export function supersedePending(db: Db, task: AiTask, exceptRunId: string): number {
  return run(
    db,
    `UPDATE proposals SET status = 'superseded', decided_at = ?, decision_note = 'Replaced by a newer run'
     WHERE status = 'pending' AND ai_run_id IN (SELECT id FROM ai_runs WHERE task = ? AND id <> ?)`,
    nowIso(),
    task,
    exceptRunId,
  )
}

// ---------- Reading ----------

function pendingPayloadName(db: Db, kind: 'create_topic' | 'create_area', id: string): string | null {
  const field = kind === 'create_topic' ? '$.title' : '$.name'
  return (
    get<{ name: string }>(
      db,
      `SELECT json_extract(payload_json, '${field}') AS name FROM proposals
       WHERE kind = ? AND json_extract(payload_json, '$.id') = ?`,
      kind,
      id,
    )?.name ?? null
  )
}

const topicName = (db: Db, id: string) =>
  `"${getTopic(db, id)?.title ?? pendingPayloadName(db, 'create_topic', id) ?? 'unknown topic'}"`
const areaName = (db: Db, id: string | null) =>
  id ? (getArea(db, id)?.name ?? pendingPayloadName(db, 'create_area', id) ?? 'unknown area') : 'Inbox'

function describe(db: Db, row: ProposalRow): { description: string; detail: string | null } {
  switch (row.kind) {
    case 'create_area': {
      const p = payloadOf({ ...row, kind: 'create_area' })
      return { description: `New area "${p.name}"`, detail: p.summary }
    }
    case 'update_area': {
      const p = payloadOf({ ...row, kind: 'update_area' })
      const current = areaName(db, p.area_id)
      const description =
        p.name && p.name !== current ? `Rename area "${current}" to "${p.name}"` : `Update the summary of "${current}"`
      return { description, detail: p.summary }
    }
    case 'create_topic': {
      const p = payloadOf({ ...row, kind: 'create_topic' })
      const under = p.parent_topic_id ? ` under ${topicName(db, p.parent_topic_id)}` : ''
      return { description: `Add "${p.title}" to ${areaName(db, p.area_id)}${under}`, detail: p.summary }
    }
    case 'update_topic': {
      const p = payloadOf({ ...row, kind: 'update_topic' })
      const name = topicName(db, p.topic_id)
      return { description: p.title ? `Rename ${name} to "${p.title}"` : `Update ${name}`, detail: p.summary }
    }
    case 'move_topic': {
      const p = payloadOf({ ...row, kind: 'move_topic' })
      return {
        description: `Move ${topicName(db, p.topic_id)} from ${areaName(db, topicAreaId(db, p.topic_id))} to ${areaName(db, p.area_id)}`,
        detail: null,
      }
    }
    case 'merge_topics': {
      const p = payloadOf({ ...row, kind: 'merge_topics' })
      return { description: `Merge ${topicName(db, p.merge_topic_id)} into ${topicName(db, p.keep_topic_id)}`, detail: null }
    }
    case 'archive_topic': {
      const p = payloadOf({ ...row, kind: 'archive_topic' })
      return { description: `Archive ${topicName(db, p.topic_id)}`, detail: null }
    }
    case 'create_link': {
      const p = payloadOf({ ...row, kind: 'create_link' })
      return {
        description: `${topicName(db, p.from_topic_id)} is ${LINK_TYPE_LABELS[p.link_type]} ${topicName(db, p.to_topic_id)}`,
        detail: null,
      }
    }
    case 'lesson_patch': {
      const p = payloadOf({ ...row, kind: 'lesson_patch' })
      const title = getLesson(db, p.lesson_id)?.title ?? 'a lesson'
      return {
        description: `Edit lesson "${title}": ${p.change_note}`,
        detail: `${p.ops.length} change${p.ops.length === 1 ? '' : 's'}. Open the lesson to see them.`,
      }
    }
    case 'remove_link': {
      const p = payloadOf({ ...row, kind: 'remove_link' })
      const link = getLink(db, p.link_id)
      return {
        description: link
          ? `Remove link: ${topicName(db, link.from_topic_id)} ${LINK_TYPE_LABELS[link.link_type]} ${topicName(db, link.to_topic_id)}`
          : 'Remove a link that no longer exists',
        detail: null,
      }
    }
  }
}

function toView(db: Db, row: ProposalRow): ProposalView {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    ...describe(db, row),
    rationale: row.rationale,
    depends_on_id: row.depends_on_id,
    area_id: row.area_id,
    lesson_id: row.kind === 'lesson_patch' ? row.target_id : null,
    decision_note: row.decision_note,
    created_at: row.created_at,
    decided_at: row.decided_at,
  }
}

export function listPendingGroups(db: Db): ProposalGroup[] {
  const rows = all<ProposalRow & { task: string | null; run_created_at: string | null; observations: string | null }>(
    db,
    `SELECT p.*, r.task, r.created_at AS run_created_at,
       CASE WHEN r.task = 'optimise' THEN json_extract(r.result_json, '$.observations') END AS observations
     FROM proposals p
     LEFT JOIN ai_runs r ON r.id = p.ai_run_id
     WHERE p.status = 'pending' ORDER BY coalesce(r.created_at, p.created_at) DESC, p.created_at, p.id`,
  )
  const groups = new Map<string, ProposalGroup>()
  for (const row of rows) {
    const key = row.ai_run_id ?? 'manual'
    if (!groups.has(key)) {
      groups.set(key, {
        ai_run_id: row.ai_run_id,
        task: row.task,
        created_at: row.run_created_at ?? row.created_at,
        observations: row.observations ? (JSON.parse(row.observations) as string[]) : [],
        proposals: [],
      })
    }
    groups.get(key)!.proposals.push(toView(db, row))
  }
  return [...groups.values()]
}

export function listRecentDecisions(db: Db, limit = 30): ProposalView[] {
  return all<ProposalRow>(
    db,
    "SELECT * FROM proposals WHERE status <> 'pending' ORDER BY decided_at DESC, id DESC LIMIT ?",
    limit,
  ).map((r) => toView(db, r))
}

export function pendingCount(db: Db): number {
  return get<{ n: number }>(db, "SELECT count(*) AS n FROM proposals WHERE status = 'pending'")?.n ?? 0
}

export function pendingCountsByArea(db: Db): Map<string, number> {
  const rows = all<{ area_id: string; n: number }>(
    db,
    "SELECT area_id, count(*) AS n FROM proposals WHERE status = 'pending' AND area_id IS NOT NULL GROUP BY area_id",
  )
  return new Map(rows.map((r) => [r.area_id, r.n]))
}
