// Lesson generation: topic → lesson v1, or teaching-only lesson → questions as a new version.
// The user asked for the lesson ("Build lesson"), so it is saved directly; edits to it go
// through lesson_patch proposals in Phase 3.
import type { DiagramKey } from '../../../shared/domain'
import {
  GeneratedLesson,
  GeneratedQuestions,
  isInteractive,
  isScheduledType,
  isTeaching,
  lessonProblems,
  type Block,
} from '../../../shared/lessons'
import { all, get, type Db } from '../db/connection'
import { AppError } from '../lib'
import { addVersion, createLesson, latestVersion, requireLesson, versionBlocks } from '../services/lessons'
import { parentOf, requireLiveTopic, subtopicPath } from '../services/topics'
import type { LessonRequestView } from '../../../shared/api'
import { topicNotes } from '../services/coauthor'
import { markBuilt, requireOpenRequest } from '../services/lessonRequests'
import { callStructured } from './client'

/** What each registered diagram shows, so Claude only picks one that fits. */
export const DIAGRAM_DESCRIPTIONS: Record<DiagramKey, string> = {
  star: 'Star schema: a fact table (fact_sales) in the centre, with date, customer, product and store dimensions around it.',
  schema: 'Columns of a fact table (foreign keys + measures) next to a dimension table (key + descriptive attributes).',
  hierarchy: 'A product → subcategory → category → department hierarchy flattened into one wide dimension.',
  conformed: 'One conformed dimension (dim_product) shared by two fact tables (fact_sales, fact_returns).',
  marketing: 'Marketing events modelled dimensionally: impression event, customer/offer/channel context, click/conversion facts.',
}

/**
 * What the person has already been taught in this topic, its parent and its prerequisites,
 * so a new lesson builds on it instead of repeating it.
 */
export function lessonDigest(db: Db, topicIds: string[]) {
  if (!topicIds.length) return []
  return all<{ topic: string; lesson_id: string; title: string; blocks_json: string; level: string | null; brief: string | null }>(
    db,
    `SELECT t.title AS topic, l.id AS lesson_id, l.title, v.blocks_json, r.level, r.brief
     FROM lessons l
     JOIN topics t ON t.id = l.topic_id
     JOIN lesson_versions v ON v.lesson_id = l.id
       AND v.version_no = (SELECT max(version_no) FROM lesson_versions WHERE lesson_id = l.id)
     LEFT JOIN lesson_requests r ON r.lesson_id = l.id
     WHERE l.archived_at IS NULL AND l.topic_id IN (SELECT value FROM json_each(?))
     ORDER BY l.created_at`,
    JSON.stringify(topicIds),
  ).map((l) => ({
    topic: l.topic,
    title: l.title,
    level: l.level,
    brief: l.brief,
    covers: versionBlocks(l).filter(isTeaching).flatMap((b) => ('title' in b ? [b.title] : [])),
  }))
}

export function topicContext(db: Db, topicId: string) {
  const topic = requireLiveTopic(db, topicId)
  const parent = parentOf(db, topicId)
  const prereqIds = all<{ id: string }>(
    db,
    `SELECT t.id FROM topic_links l JOIN topics t ON t.id = l.from_topic_id
     WHERE l.to_topic_id = ? AND l.link_type = 'prerequisite_of' AND t.archived_at IS NULL`,
    topicId,
  ).map((r) => r.id)
  const area = topic.area_id ? get<{ name: string }>(db, 'SELECT name FROM areas WHERE id = ?', topic.area_id) : undefined
  const prerequisites = all<{ title: string }>(
    db,
    `SELECT t.title FROM topic_links l JOIN topics t ON t.id = l.from_topic_id
     WHERE l.to_topic_id = ? AND l.link_type = 'prerequisite_of' AND t.archived_at IS NULL`,
    topicId,
  )
  const related = all<{ title: string }>(
    db,
    `SELECT t.title FROM topic_links l
     JOIN topics t ON t.id = CASE WHEN l.from_topic_id = ? THEN l.to_topic_id ELSE l.from_topic_id END
     WHERE ? IN (l.from_topic_id, l.to_topic_id) AND l.link_type <> 'prerequisite_of' AND t.archived_at IS NULL`,
    topicId,
    topicId,
  )
  return {
    topic: { title: topic.title, summary: topic.summary, why_i_care: topic.why_i_care, area: area?.name ?? null },
    parent_topic: parent?.title ?? null,
    sub_topics_in_order: subtopicPath(db, topicId).map((s) => s.title),
    prerequisites: prerequisites.map((r) => r.title),
    related: related.map((r) => r.title),
    existing_lessons: lessonDigest(db, [topicId, ...(parent ? [parent.id] : []), ...prereqIds]),
    my_notes: topicNotes(db, topicId),
    resources: all<{ kind: string; title: string; url: string | null; note: string | null }>(
      db,
      'SELECT kind, title, url, note FROM resources WHERE topic_id = ? AND archived_at IS NULL',
      topicId,
    ),
    diagram_keys: Object.entries(DIAGRAM_DESCRIPTIONS).map(([key, shows]) => ({ key, shows })),
  }
}

export function checkGeneratedLesson(out: GeneratedLesson): string[] {
  const problems = lessonProblems(out.blocks)
  if (!out.blocks.some((b) => isScheduledType(b.type))) problems.push('the lesson has no questions')
  return problems
}

/** Puts each question after the teaching block it follows (in the order given) and the project last. */
export function mergeQuestions(teaching: Block[], out: GeneratedQuestions) {
  const blocks: ({ type: string; id: string | null } & Record<string, unknown>)[] = []
  for (const block of teaching) {
    blocks.push(block)
    for (const q of out.questions.filter((q) => q.after_block_id === block.id)) blocks.push(q.block)
  }
  blocks.push(out.project_prompt)
  return blocks
}

export function checkGeneratedQuestions(out: GeneratedQuestions, teaching: Block[]): string[] {
  const ids = new Set(teaching.map((b) => b.id))
  const problems = out.questions
    .filter((q) => !ids.has(q.after_block_id))
    .map((q) => `after_block_id "${q.after_block_id}" is not a block of this lesson`)
  if (!out.questions.length) problems.push('there are no questions')
  return problems.length ? problems : lessonProblems(mergeQuestions(teaching, out))
}

export async function generateLesson(
  db: Db,
  topicId: string,
  request: LessonRequestView | null = null,
): Promise<{ lessonId: string; runId: string }> {
  const ctx = topicContext(db, topicId)
  const { runId, result } = await callStructured(db, {
    task: 'generate_lesson',
    promptName: 'lesson_generator',
    schema: GeneratedLesson,
    input: {
      mode: 'full_lesson',
      ...ctx,
      request: request && {
        level: request.level,
        brief: request.brief,
        conversation: request.messages,
        agreed_plan: request.plan,
      },
    },
    check: checkGeneratedLesson,
    effort: 'high',
  })
  const { lessonId } = createLesson(db, {
    topicId,
    title: result.title,
    origin: 'ai',
    blocks: result.blocks,
    createdBy: 'ai',
    aiRunId: runId,
    changeNote: 'Generated by Build lesson',
  })
  return { lessonId, runId }
}

/** Writes the lesson a Build lesson conversation asked for, whether or not planning finished. */
export async function buildFromRequest(db: Db, requestId: string): Promise<{ lessonId: string; runId: string }> {
  const request = requireOpenRequest(db, requestId)
  const built = await generateLesson(db, request.topic_id, request)
  markBuilt(db, requestId, built.lessonId)
  return built
}

/** Adds questions to a lesson that has none yet (e.g. an imported article), as a new version. */
export async function generateQuestions(db: Db, lessonId: string): Promise<{ versionId: string; runId: string }> {
  const lesson = requireLesson(db, lessonId)
  const version = latestVersion(db, lessonId)
  const blocks = versionBlocks(version)
  if (blocks.some(isInteractive)) {
    throw new AppError('This lesson already has questions. Editing them comes with co-authoring.', 409)
  }
  const teaching = blocks.filter(isTeaching)
  const { runId, result } = await callStructured(db, {
    task: 'generate_lesson',
    promptName: 'lesson_generator',
    schema: GeneratedQuestions,
    input: { mode: 'questions_only', ...topicContext(db, lesson.topic_id), lesson: { title: lesson.title, blocks: teaching } },
    check: (out) => checkGeneratedQuestions(out, teaching),
    effort: 'high',
  })
  const versionId = addVersion(db, lessonId, {
    blocks: mergeQuestions(teaching, result),
    createdBy: 'ai',
    aiRunId: runId,
    basedOnVersionId: version.id,
    changeNote: 'Questions added by AI',
  })
  return { versionId, runId }
}
