// Capture: brain-dump → create_topic (and create_area) proposals.
import { z } from 'zod'
import type { ProposalDraft } from '../../../shared/proposals'
import { all, type Db } from '../db/connection'
import { newId } from '../lib'
import { parentEdges } from '../services/links'
import { createProposals } from '../services/proposals'
import { callStructured } from './client'

export const CaptureOutput = z.object({
  new_areas: z.array(
    z.object({
      ref: z.string().describe('Short local reference used by topics, e.g. "a1"'),
      name: z.string().min(1),
      summary: z.string(),
    }),
  ),
  topics: z.array(
    z.object({
      ref: z.string().describe('Short local reference, e.g. "t1", used by parent_ref'),
      title: z.string().min(1).max(120),
      summary: z.string(),
      why_i_care: z.string().nullable(),
      area_id: z.string().nullable().describe('Id of an existing area, or null'),
      new_area_ref: z.string().nullable().describe('ref of an entry in new_areas, or null'),
      parent_topic_id: z.string().nullable().describe('Id of an existing topic this is a sub-topic of, or null'),
      parent_ref: z.string().nullable().describe('ref of another new topic this is a sub-topic of, or null'),
      rationale: z.string(),
    }),
  ),
  duplicates: z.array(
    z.object({
      mention: z.string(),
      existing_topic_id: z.string(),
      reason: z.string(),
    }),
  ),
})
export type CaptureOutput = z.infer<typeof CaptureOutput>

export interface CaptureResult {
  runId: string
  created: number
  newAreas: number
  skipped: { title: string; reason: string }[]
}

function captureContext(db: Db) {
  const areas = all<{ id: string; name: string; summary: string | null }>(
    db,
    'SELECT id, name, summary FROM areas WHERE archived_at IS NULL ORDER BY position',
  )
  const topics = all<{ id: string; title: string; summary: string | null; area_id: string | null }>(
    db,
    'SELECT id, title, summary, area_id FROM topics WHERE archived_at IS NULL ORDER BY lower(title)',
  )
  // Topics that are already sub-topics cannot be parents (area › topic › sub-topic).
  const subtopicIds = parentEdges(db).map(([child]) => child)
  const pendingTitles = all<{ title: string }>(
    db,
    `SELECT json_extract(payload_json, '$.title') AS title FROM proposals
     WHERE kind = 'create_topic' AND status = 'pending'`,
  ).map((r) => r.title)
  return { areas, topics, pendingTitles, subtopicIds }
}

type CaptureContext = Omit<ReturnType<typeof captureContext>, 'subtopicIds'> & { subtopicIds?: string[] }

export function checkCapture(output: CaptureOutput, ctx: CaptureContext): string[] {
  const problems: string[] = []
  const areaIds = new Set(ctx.areas.map((a) => a.id))
  const topicIds = new Set(ctx.topics.map((t) => t.id))
  const refs = new Set<string>()
  const existingAreaNames = new Set(ctx.areas.map((a) => a.name.toLowerCase()))
  for (const a of output.new_areas) {
    if (refs.has(a.ref)) problems.push(`new_areas ref "${a.ref}" is used twice`)
    refs.add(a.ref)
    if (existingAreaNames.has(a.name.toLowerCase())) {
      problems.push(`new area "${a.name}" already exists; use its area_id instead`)
    }
  }
  const titles = new Set<string>()
  for (const t of output.topics) {
    if (titles.has(t.title.toLowerCase())) problems.push(`topic "${t.title}" appears twice`)
    titles.add(t.title.toLowerCase())
    if (t.area_id && t.new_area_ref) problems.push(`topic "${t.title}" sets both area_id and new_area_ref`)
    if (t.area_id && !areaIds.has(t.area_id)) problems.push(`topic "${t.title}" has unknown area_id "${t.area_id}"`)
    if (t.new_area_ref && !refs.has(t.new_area_ref)) {
      problems.push(`topic "${t.title}" has unknown new_area_ref "${t.new_area_ref}"`)
    }
  }
  const topicRefs = new Map(output.topics.map((t) => [t.ref, t]))
  if (topicRefs.size !== output.topics.length) problems.push('topic refs must be unique')
  const subtopics = new Set(ctx.subtopicIds ?? [])
  for (const t of output.topics) {
    if (t.parent_topic_id && t.parent_ref) problems.push(`topic "${t.title}" sets both parent_topic_id and parent_ref`)
    if (t.parent_topic_id && !topicIds.has(t.parent_topic_id)) {
      problems.push(`topic "${t.title}" has unknown parent_topic_id "${t.parent_topic_id}"`)
    }
    if (t.parent_topic_id && subtopics.has(t.parent_topic_id)) {
      problems.push(`topic "${t.title}": its parent is already a sub-topic; sub-topics go only one level deep`)
    }
    if (t.parent_ref) {
      const parent = topicRefs.get(t.parent_ref)
      if (!parent) problems.push(`topic "${t.title}" has unknown parent_ref "${t.parent_ref}"`)
      else if (parent === t) problems.push(`topic "${t.title}" cannot be its own parent`)
      else if (parent.parent_ref || parent.parent_topic_id) {
        problems.push(`topic "${t.title}": its parent "${parent.title}" is itself a sub-topic; sub-topics go only one level deep`)
      }
    }
  }
  for (const d of output.duplicates) {
    if (!topicIds.has(d.existing_topic_id)) problems.push(`duplicate "${d.mention}" points at unknown topic id`)
  }
  return problems
}

/** Turns validated output into proposals, dropping anything that already exists or is pending. */
export function captureDrafts(output: CaptureOutput, ctx: CaptureContext) {
  const taken = new Set([...ctx.topics.map((t) => t.title.toLowerCase()), ...ctx.pendingTitles.map((t) => t.toLowerCase())])
  const skipped: CaptureResult['skipped'] = output.duplicates.map((d) => ({
    title: d.mention,
    reason: `Already on your map as "${ctx.topics.find((t) => t.id === d.existing_topic_id)?.title}"`,
  }))
  const drafts: ProposalDraft[] = []
  const areaProposals = new Map<string, { proposalId: string; areaId: string }>()

  const created = new Map<string, { proposalId: string; topicId: string; areaId: string | null }>()
  // Parents first, so a sub-topic can depend on its parent's proposal.
  const ordered = [...output.topics].sort((a, b) => Number(Boolean(a.parent_ref)) - Number(Boolean(b.parent_ref)))
  for (const t of ordered) {
    if (taken.has(t.title.toLowerCase())) {
      skipped.push({ title: t.title, reason: 'Already on your map or waiting for review' })
      continue
    }
    taken.add(t.title.toLowerCase())
    let areaId = t.area_id
    let dependsOn: string | null = null
    if (t.new_area_ref) {
      let area = areaProposals.get(t.new_area_ref)
      if (!area) {
        const a = output.new_areas.find((a) => a.ref === t.new_area_ref)!
        area = { proposalId: newId(), areaId: newId() }
        areaProposals.set(t.new_area_ref, area)
        drafts.push({
          id: area.proposalId,
          kind: 'create_area',
          payload: { id: area.areaId, name: a.name, summary: a.summary || null },
          rationale: `Needed for "${t.title}"`,
        })
      }
      areaId = area.areaId
      dependsOn = area.proposalId
    }
    // A sub-topic sits in its parent's area.
    let parentId: string | null = null
    const newParent = t.parent_ref ? created.get(t.parent_ref) : undefined
    if (newParent) {
      parentId = newParent.topicId
      areaId = newParent.areaId
      dependsOn = newParent.proposalId
    } else if (t.parent_topic_id) {
      parentId = t.parent_topic_id
      areaId = ctx.topics.find((x) => x.id === t.parent_topic_id)?.area_id ?? null
      dependsOn = null
    }
    const proposalId = newId()
    const topicId = newId()
    created.set(t.ref, { proposalId, topicId, areaId })
    drafts.push({
      id: proposalId,
      kind: 'create_topic',
      payload: {
        id: topicId,
        title: t.title,
        summary: t.summary || null,
        why_i_care: t.why_i_care || null,
        area_id: areaId,
        parent_topic_id: parentId,
      },
      rationale: t.rationale || null,
      depends_on_id: dependsOn,
    })
  }
  return { drafts, skipped, newAreas: areaProposals.size }
}

export async function runCapture(db: Db, text: string): Promise<CaptureResult> {
  const ctx = captureContext(db)
  const { runId, result } = await callStructured(db, {
    task: 'capture',
    promptName: 'capture',
    schema: CaptureOutput,
    input: {
      brain_dump: text,
      existing_areas: ctx.areas,
      existing_topics: ctx.topics.map((t) => ({ ...t, is_subtopic: ctx.subtopicIds.includes(t.id) })),
      topics_waiting_for_review: ctx.pendingTitles,
    },
    check: (out) => checkCapture(out, ctx),
    effort: 'medium',
  })
  const { drafts, skipped, newAreas } = captureDrafts(result, ctx)
  createProposals(db, runId, drafts)
  return { runId, created: drafts.length - newAreas, newAreas, skipped }
}
