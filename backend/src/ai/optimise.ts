// Optimise: reads what your answers say (confidently wrong, forgotten often, decaying topics,
// overrides measurement contradicts) and proposes map changes through the normal proposals.
import { z } from 'zod'
import { LINK_TYPES } from '../../../shared/domain'
import type { OptimiseSignals } from '../../../shared/api'
import type { InteractiveBlock } from '../../../shared/lessons'
import type { ProposalDraft } from '../../../shared/proposals'
import { all, type Db } from '../db/connection'
import { newId } from '../lib'
import { versionBlocks } from '../services/lessons'
import { linkProblem, normaliseLink, parentEdges, parentProblem, type Edge } from '../services/links'
import { createProposals, supersedePending } from '../services/proposals'
import { listTopics } from '../services/topics'
import { callStructured } from './client'

export const OptimiseOutput = z.object({
  observations: z.array(z.string().min(1).max(300)).max(5).describe('What the answers show, in plain words'),
  new_topics: z.array(
    z.object({
      title: z.string().min(1).max(120),
      summary: z.string(),
      area_id: z.string().nullable(),
      parent_topic_id: z.string().nullable(),
      prerequisite_of: z.string().nullable().describe('An existing topic this new topic should be learned before, or null'),
      rationale: z.string(),
    }),
  ),
  new_links: z.array(
    z.object({ from_topic_id: z.string(), to_topic_id: z.string(), link_type: z.enum(LINK_TYPES), rationale: z.string() }),
  ),
  merges: z.array(z.object({ keep_topic_id: z.string(), merge_topic_id: z.string(), rationale: z.string() })),
})
export type OptimiseOutput = z.infer<typeof OptimiseOutput>

const questionText = (b: InteractiveBlock | undefined): string => {
  if (!b) return '(question no longer in the lesson)'
  switch (b.type) {
    case 'quiz_mcq':
      return `${b.question} [right answer: ${b.options[b.correct_index]}]`
    case 'quiz_true_false':
      return `${b.statement} [${b.answer ? 'true' : 'false'}]`
    case 'fill_in_blank':
      return `${b.sentence} [${b.acceptable_answers[0]}]`
    case 'code_challenge':
      return `${b.question} [${b.expected_answer}]`
    case 'ordering':
      return `${b.prompt} [${b.correct_order.join(' → ')}]`
    case 'project_prompt':
      return b.description
  }
}

/** The evidence the optimise loop works from. Empty lists mean nothing to act on yet. */
export function optimiseSignals(db: Db, now = new Date()): OptimiseSignals {
  const since = new Date(now.getTime() - 60 * 86_400_000).toISOString()
  const withQuestion = <T extends { blocks_json: string; block_id: string }>(rows: T[]) =>
    rows.map(({ blocks_json, block_id, ...rest }) => ({
      ...rest,
      question: questionText(versionBlocks({ blocks_json }).find((b) => b.id === block_id) as InteractiveBlock | undefined),
    }))

  const confidentlyWrong = withQuestion(
    all<{ topic: string; lesson: string; blocks_json: string; block_id: string; times: number }>(
      db,
      `SELECT t.title AS topic, l.title AS lesson, v.blocks_json, ri.block_id, count(*) AS times
       FROM attempts a
       JOIN review_items ri ON ri.id = a.review_item_id
       JOIN lessons l ON l.id = ri.lesson_id
       JOIN topics t ON t.id = l.topic_id AND t.archived_at IS NULL
       JOIN lesson_versions v ON v.id = a.lesson_version_id
       WHERE a.is_correct = 0 AND a.confidence = 3 AND a.answered_at >= ?
       GROUP BY ri.id ORDER BY times DESC, max(a.answered_at) DESC LIMIT 30`,
      since,
    ),
  )
  const struggling = withQuestion(
    all<{ topic: string; lesson: string; blocks_json: string; block_id: string; lapses: number; difficulty: number }>(
      db,
      `SELECT t.title AS topic, l.title AS lesson, v.blocks_json, ri.block_id, s.lapses, round(s.difficulty, 1) AS difficulty
       FROM review_item_state s
       JOIN review_items ri ON ri.id = s.review_item_id AND ri.retired_at IS NULL
       JOIN lessons l ON l.id = ri.lesson_id AND l.archived_at IS NULL
       JOIN topics t ON t.id = l.topic_id AND t.archived_at IS NULL
       JOIN lesson_versions v ON v.lesson_id = l.id
         AND v.version_no = (SELECT max(version_no) FROM lesson_versions WHERE lesson_id = l.id)
       WHERE s.lapses >= 2 OR s.difficulty >= 7
       ORDER BY s.lapses DESC, s.difficulty DESC LIMIT 30`,
    ),
  )
  const topics = listTopics(db)
  const decaying = topics
    .filter((t) => t.status.mastery !== null && t.status.reviewsDue > 0 && t.status.mastery < 0.6)
    .map((t) => ({ topic: t.title, mastery: Math.round(t.status.mastery! * 100), reviews_due: t.status.reviewsDue }))
  const contradicted = topics
    .filter((t) => t.status.override && t.status.mastery !== null && t.status.override !== t.status.derived)
    .map((t) => ({
      topic: t.title,
      you_set: t.status.override!,
      measured: t.status.derived,
      mastery: Math.round(t.status.mastery! * 100),
    }))
  return { confidentlyWrong, struggling, decaying, contradicted }
}

export const hasSignals = (s: OptimiseSignals) =>
  s.confidentlyWrong.length + s.struggling.length + s.decaying.length + s.contradicted.length > 0

function mapContext(db: Db) {
  const parentOf = new Map(parentEdges(db))
  return {
    areas: all<{ id: string; name: string }>(db, 'SELECT id, name FROM areas WHERE archived_at IS NULL ORDER BY position'),
    topics: listTopics(db).map((t) => ({
      id: t.id,
      title: t.title,
      summary: t.summary,
      area_id: t.area_id,
      parent_topic_id: parentOf.get(t.id) ?? null,
      status: t.status.effective,
    })),
    links: all<{ from_topic_id: string; to_topic_id: string; link_type: string }>(
      db,
      `SELECT l.from_topic_id, l.to_topic_id, l.link_type FROM topic_links l
       JOIN topics a ON a.id = l.from_topic_id AND a.archived_at IS NULL
       JOIN topics b ON b.id = l.to_topic_id AND b.archived_at IS NULL`,
    ),
  }
}

export function checkOptimise(db: Db, out: OptimiseOutput, ctx: ReturnType<typeof mapContext>): string[] {
  const problems: string[] = []
  const areaIds = new Set(ctx.areas.map((a) => a.id))
  const byId = new Map(ctx.topics.map((t) => [t.id, t]))
  const titles = new Set(ctx.topics.map((t) => t.title.toLowerCase()))
  const parents: Edge[] = parentEdges(db)
  out.new_topics.forEach((t, i) => {
    const where = `new_topics[${i}] "${t.title}"`
    if (titles.has(t.title.toLowerCase())) problems.push(`${where}: a topic with that title already exists`)
    titles.add(t.title.toLowerCase())
    if (t.area_id && !areaIds.has(t.area_id)) problems.push(`${where}: unknown area_id`)
    if (t.parent_topic_id) {
      if (!byId.has(t.parent_topic_id)) problems.push(`${where}: unknown parent_topic_id`)
      else {
        const problem = parentProblem(parents, `new-${i}`, t.parent_topic_id)
        if (problem) problems.push(`${where}: ${problem}`)
      }
    }
    if (t.prerequisite_of && !byId.has(t.prerequisite_of)) problems.push(`${where}: unknown prerequisite_of`)
  })
  const prereqs: Edge[] = []
  const batchParents: Edge[] = []
  for (const l of out.new_links) {
    const names = `${byId.get(l.from_topic_id)?.title ?? l.from_topic_id} → ${byId.get(l.to_topic_id)?.title ?? l.to_topic_id}`
    const problem = linkProblem(db, l.from_topic_id, l.to_topic_id, l.link_type, prereqs, batchParents)
    if (problem) problems.push(`new_links ${names} (${l.link_type}): ${problem}`)
    else if (l.link_type === 'prerequisite_of') prereqs.push(normaliseLink(l.from_topic_id, l.to_topic_id, l.link_type))
    else if (l.link_type === 'part_of') batchParents.push([l.from_topic_id, l.to_topic_id])
  }
  const merged = new Set<string>()
  for (const m of out.merges) {
    if (!byId.has(m.keep_topic_id) || !byId.has(m.merge_topic_id)) problems.push('merges: unknown topic id')
    if (m.keep_topic_id === m.merge_topic_id) problems.push('merges: a topic cannot merge into itself')
    if (merged.has(m.keep_topic_id) || merged.has(m.merge_topic_id)) problems.push('merges: a topic appears in two merges')
    merged.add(m.keep_topic_id)
    merged.add(m.merge_topic_id)
  }
  return problems
}

export function optimiseDrafts(out: OptimiseOutput, ctx: ReturnType<typeof mapContext>): ProposalDraft[] {
  const drafts: ProposalDraft[] = []
  const areaOf = (id: string) => ctx.topics.find((t) => t.id === id)?.area_id ?? null
  for (const t of out.new_topics) {
    const proposalId = newId()
    const topicId = newId()
    drafts.push({
      id: proposalId,
      kind: 'create_topic',
      payload: {
        id: topicId,
        title: t.title,
        summary: t.summary || null,
        why_i_care: null,
        area_id: t.parent_topic_id ? areaOf(t.parent_topic_id) : (t.area_id ?? (t.prerequisite_of ? areaOf(t.prerequisite_of) : null)),
        parent_topic_id: t.parent_topic_id,
      },
      rationale: t.rationale,
    })
    if (t.prerequisite_of) {
      drafts.push({
        id: newId(),
        kind: 'create_link',
        payload: { id: newId(), from_topic_id: topicId, to_topic_id: t.prerequisite_of, link_type: 'prerequisite_of' },
        rationale: t.rationale,
        depends_on_id: proposalId,
      })
    }
  }
  for (const l of out.new_links) {
    drafts.push({
      id: newId(),
      kind: 'create_link',
      payload: { id: newId(), from_topic_id: l.from_topic_id, to_topic_id: l.to_topic_id, link_type: l.link_type },
      rationale: l.rationale,
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
  return drafts
}

export async function runOptimise(db: Db): Promise<{ runId: string | null; created: number; observations: string[] }> {
  const signals = optimiseSignals(db)
  if (!hasSignals(signals)) {
    return { runId: null, created: 0, observations: ['Nothing to learn from yet: no wrong-but-certain answers, forgotten questions or decaying topics.'] }
  }
  const ctx = mapContext(db)
  const { runId, result } = await callStructured(db, {
    task: 'optimise',
    promptName: 'optimise',
    schema: OptimiseOutput,
    input: { signals, map: ctx },
    check: (out) => checkOptimise(db, out, ctx),
    effort: 'high',
  })
  supersedePending(db, 'optimise', runId)
  const drafts = optimiseDrafts(result, ctx)
  createProposals(db, runId, drafts)
  return { runId, created: drafts.length, observations: result.observations }
}
