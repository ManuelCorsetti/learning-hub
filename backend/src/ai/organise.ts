// Organise: Claude suggests changes to areas and links across the whole map.
import { z } from 'zod'
import { LINK_TYPES } from '../../../shared/domain'
import type { ProposalDraft } from '../../../shared/proposals'
import { all, type Db } from '../db/connection'
import { newId } from '../lib'
import { linkProblem, normaliseLink, type Edge } from '../services/links'
import { createProposals, supersedePending } from '../services/proposals'
import { listTopics } from '../services/topics'
import { callStructured } from './client'

export const OrganiseOutput = z.object({
  new_areas: z.array(z.object({ ref: z.string(), name: z.string().min(1), summary: z.string(), rationale: z.string() })),
  area_updates: z.array(
    z.object({ area_id: z.string(), name: z.string().nullable(), summary: z.string().nullable(), rationale: z.string() }),
  ),
  moves: z.array(
    z.object({
      topic_id: z.string(),
      to_area_id: z.string().nullable(),
      to_new_area_ref: z.string().nullable(),
      rationale: z.string(),
    }),
  ),
  merges: z.array(z.object({ keep_topic_id: z.string(), merge_topic_id: z.string(), rationale: z.string() })),
  new_links: z.array(
    z.object({
      from_topic_id: z.string(),
      to_topic_id: z.string(),
      link_type: z.enum(LINK_TYPES),
      rationale: z.string(),
    }),
  ),
  removed_links: z.array(z.object({ link_id: z.string(), rationale: z.string() })),
})
export type OrganiseOutput = z.infer<typeof OrganiseOutput>

function organiseContext(db: Db) {
  const areas = all<{ id: string; name: string; summary: string | null }>(
    db,
    'SELECT id, name, summary FROM areas WHERE archived_at IS NULL ORDER BY position',
  )
  const topics = listTopics(db).map((t) => ({
    id: t.id,
    title: t.title,
    summary: t.summary,
    area_id: t.area_id,
    status: t.status.effective,
  }))
  const links = all<{ id: string; from_topic_id: string; to_topic_id: string; link_type: string }>(
    db,
    `SELECT l.id, l.from_topic_id, l.to_topic_id, l.link_type FROM topic_links l
     JOIN topics a ON a.id = l.from_topic_id AND a.archived_at IS NULL
     JOIN topics b ON b.id = l.to_topic_id AND b.archived_at IS NULL`,
  )
  return { areas, topics, links }
}

export function checkOrganise(db: Db, out: OrganiseOutput, ctx: ReturnType<typeof organiseContext>): string[] {
  const problems: string[] = []
  const areaIds = new Set(ctx.areas.map((a) => a.id))
  const topicById = new Map(ctx.topics.map((t) => [t.id, t]))
  const linkIds = new Set(ctx.links.map((l) => l.id))
  const refs = new Set(out.new_areas.map((a) => a.ref))
  if (refs.size !== out.new_areas.length) problems.push('new_areas refs must be unique')
  const areaNames = new Set(ctx.areas.map((a) => a.name.toLowerCase()))
  for (const a of out.new_areas) if (areaNames.has(a.name.toLowerCase())) problems.push(`area "${a.name}" already exists`)

  for (const u of out.area_updates) {
    if (!areaIds.has(u.area_id)) problems.push(`area_updates: unknown area_id "${u.area_id}"`)
    if (!u.name && !u.summary) problems.push(`area_updates for "${u.area_id}" changes nothing`)
  }
  const touched = new Set<string>()
  for (const m of out.moves) {
    const topic = topicById.get(m.topic_id)
    if (!topic) problems.push(`moves: unknown topic_id "${m.topic_id}"`)
    if (Boolean(m.to_area_id) === Boolean(m.to_new_area_ref)) {
      problems.push(`moves for "${topic?.title ?? m.topic_id}" must set exactly one of to_area_id or to_new_area_ref`)
    }
    if (m.to_area_id && !areaIds.has(m.to_area_id)) problems.push(`moves: unknown to_area_id "${m.to_area_id}"`)
    if (m.to_new_area_ref && !refs.has(m.to_new_area_ref)) problems.push(`moves: unknown ref "${m.to_new_area_ref}"`)
    if (topic && m.to_area_id && topic.area_id === m.to_area_id) problems.push(`"${topic.title}" is already in that area`)
    if (touched.has(m.topic_id)) problems.push(`"${topic?.title ?? m.topic_id}" is moved more than once`)
    touched.add(m.topic_id)
  }
  const merged = new Set<string>()
  for (const m of out.merges) {
    if (!topicById.has(m.keep_topic_id) || !topicById.has(m.merge_topic_id)) problems.push('merges: unknown topic id')
    if (m.keep_topic_id === m.merge_topic_id) problems.push('merges: a topic cannot merge into itself')
    if (merged.has(m.merge_topic_id) || merged.has(m.keep_topic_id)) problems.push('merges: a topic appears in two merges')
    merged.add(m.merge_topic_id)
    merged.add(m.keep_topic_id)
  }
  const proposed: Edge[] = []
  const seenLinks = new Set<string>()
  for (const l of out.new_links) {
    const names = `${topicById.get(l.from_topic_id)?.title ?? l.from_topic_id} → ${topicById.get(l.to_topic_id)?.title ?? l.to_topic_id}`
    const [f, t] = normaliseLink(l.from_topic_id, l.to_topic_id, l.link_type)
    const key = `${f}|${t}|${l.link_type}`
    if (seenLinks.has(key)) problems.push(`new_links: ${names} is proposed twice`)
    seenLinks.add(key)
    const problem = linkProblem(db, l.from_topic_id, l.to_topic_id, l.link_type, proposed)
    if (problem) problems.push(`new_links ${names} (${l.link_type}): ${problem}`)
    else if (l.link_type === 'prerequisite_of') proposed.push([f, t])
  }
  for (const r of out.removed_links) if (!linkIds.has(r.link_id)) problems.push(`removed_links: unknown link_id "${r.link_id}"`)
  return problems
}

export function organiseDrafts(out: OrganiseOutput): ProposalDraft[] {
  const drafts: ProposalDraft[] = []
  const newAreas = new Map<string, { proposalId: string; areaId: string }>()
  for (const a of out.new_areas) {
    const ids = { proposalId: newId(), areaId: newId() }
    newAreas.set(a.ref, ids)
    drafts.push({
      id: ids.proposalId,
      kind: 'create_area',
      payload: { id: ids.areaId, name: a.name, summary: a.summary || null },
      rationale: a.rationale,
    })
  }
  for (const u of out.area_updates) {
    drafts.push({
      id: newId(),
      kind: 'update_area',
      payload: { area_id: u.area_id, name: u.name, summary: u.summary },
      rationale: u.rationale,
    })
  }
  for (const m of out.moves) {
    const created = m.to_new_area_ref ? newAreas.get(m.to_new_area_ref) : undefined
    drafts.push({
      id: newId(),
      kind: 'move_topic',
      payload: { topic_id: m.topic_id, area_id: created?.areaId ?? m.to_area_id },
      rationale: m.rationale,
      depends_on_id: created?.proposalId ?? null,
    })
  }
  for (const m of out.merges) {
    drafts.push({
      id: newId(),
      kind: 'merge_topics',
      payload: { keep_topic_id: m.keep_topic_id, merge_topic_id: m.merge_topic_id },
      rationale: m.rationale,
    })
  }
  for (const l of out.new_links) {
    drafts.push({
      id: newId(),
      kind: 'create_link',
      payload: { id: newId(), from_topic_id: l.from_topic_id, to_topic_id: l.to_topic_id, link_type: l.link_type },
      rationale: l.rationale,
    })
  }
  for (const r of out.removed_links) {
    drafts.push({ id: newId(), kind: 'remove_link', payload: { link_id: r.link_id }, rationale: r.rationale })
  }
  return drafts
}

export async function runOrganise(db: Db): Promise<{ runId: string; created: number; superseded: number }> {
  const ctx = organiseContext(db)
  if (ctx.topics.length < 2) return { runId: '', created: 0, superseded: 0 }
  const { runId, result } = await callStructured(db, {
    task: 'organise',
    promptName: 'organise',
    schema: OrganiseOutput,
    input: ctx,
    check: (out) => checkOrganise(db, out, ctx),
    effort: 'high',
  })
  const superseded = supersedePending(db, 'organise', runId)
  const drafts = organiseDrafts(result)
  createProposals(db, runId, drafts)
  return { runId, created: drafts.length, superseded }
}
