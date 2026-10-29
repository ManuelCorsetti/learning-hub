// Ask: a question about text the person selected anywhere in the app. Claude answers from the
// page it came from (lesson, topic or area). Nothing is written except the ai_runs log.
import { z } from 'zod'
import type { AskAnswer, AskInput } from '../../../shared/api'
import { isInteractive } from '../../../shared/lessons'
import { all, get, type Db } from '../db/connection'
import { requireLiveArea } from '../services/areas'
import { latestVersion, requireLesson, versionBlocks } from '../services/lessons'
import { callStructured } from './client'
import { topicContext } from './lessons'

export const AskOutput = z.object({
  answer: z.string().min(1).max(5000).describe('The answer, in Markdown: short paragraphs, lists and `code` only'),
  follow_ups: z.array(z.string().min(1).max(120)).max(3).describe('Up to three short follow-up questions the person might ask next'),
})

/** Topic context without what only lesson generation needs. */
function topicBrief(db: Db, topicId: string) {
  const { diagram_keys: _, ...rest } = topicContext(db, topicId)
  return rest
}

/** What the page the selection came from is about. The most specific context wins. */
export function askContext(db: Db, context: AskInput['context']) {
  if (context.lesson_id) {
    const lesson = requireLesson(db, context.lesson_id)
    const blocks = versionBlocks(latestVersion(db, lesson.id))
    const block = context.block_id ? blocks.find((b) => b.id === context.block_id) : undefined
    const answered =
      block && isInteractive(block)
        ? Boolean(
            get<{ n: number }>(
              db,
              `SELECT count(*) AS n FROM attempts a JOIN review_items ri ON ri.id = a.review_item_id
               WHERE ri.lesson_id = ? AND ri.block_id = ?`,
              lesson.id,
              block.id,
            )?.n,
          )
        : null
    return {
      page: 'lesson',
      ...topicBrief(db, lesson.topic_id),
      lesson: { title: lesson.title, blocks },
      ...(block && { selected_from_block: { id: block.id, type: block.type, ...(answered !== null && { already_answered: answered }) } }),
    }
  }
  if (context.topic_id) return { page: 'topic', ...topicBrief(db, context.topic_id) }
  if (context.area_id) {
    const area = requireLiveArea(db, context.area_id)
    const topics = all<{ title: string; summary: string | null }>(
      db,
      'SELECT title, summary FROM topics WHERE area_id = ? AND archived_at IS NULL ORDER BY title',
      area.id,
    )
    return { page: 'area', area: { name: area.name, summary: area.summary, topics } }
  }
  return { page: 'other' }
}

export async function askAboutSelection(db: Db, input: AskInput): Promise<AskAnswer> {
  const { runId, result } = await callStructured(db, {
    task: 'ask',
    promptName: 'ask',
    schema: AskOutput,
    input: {
      context: askContext(db, input.context),
      conversation: input.history,
      selection: input.selection,
      question: input.question,
    },
    effort: 'medium',
  })
  return { answer: result.answer, follow_ups: result.follow_ups, run_id: runId }
}
