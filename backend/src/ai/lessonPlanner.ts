// Plans a lesson with the person before it is written: checks the brief against the profile
// and the topic, asks up to three questions, and proposes an outline. The person can build
// at any point; the planner only advises.
import { z } from 'zod'
import type { LessonRequestMessage, LessonRequestView } from '../../../shared/api'
import type { Db } from '../db/connection'
import { appendMessages, requireOpenRequest } from '../services/lessonRequests'
import { callStructured } from './client'
import { topicContext } from './lessons'

export const PlanTurn = z.object({
  reply: z.string().min(1).max(1500).describe('What you say to the person: short, direct, no preamble'),
  questions: z.array(z.string().min(1).max(300)).max(3).describe('Specific questions; empty when ready'),
  ready: z.boolean().describe('True when you have enough to write a lesson that fits'),
  plan: z.object({
    title: z.string().min(1).max(120),
    summary: z.string().min(1).max(600),
    outline: z.array(z.string().min(1).max(160)).min(2).max(6),
    examples: z.string().max(300),
  }),
})
export type PlanTurn = z.infer<typeof PlanTurn>

export function checkPlanTurn(out: PlanTurn): string[] {
  if (out.ready && out.questions.length) return ['when ready is true, questions must be empty']
  if (!out.ready && !out.questions.length) return ['when ready is false, ask at least one question']
  return []
}

/** Runs one planner turn, optionally after a new message from the person. */
export async function planLessonTurn(db: Db, requestId: string, message?: string): Promise<LessonRequestView> {
  const request = requireOpenRequest(db, requestId)
  const userTurn: LessonRequestMessage[] = message ? [{ role: 'user', content: message }] : []
  const { result } = await callStructured(db, {
    task: 'plan_lesson',
    promptName: 'lesson_planner',
    schema: PlanTurn,
    input: {
      ...topicContext(db, request.topic_id),
      level: request.level,
      brief: request.brief,
      conversation: [...request.messages, ...userTurn],
    },
    check: checkPlanTurn,
    effort: 'medium',
  })
  return appendMessages(
    db,
    requestId,
    [...userTurn, { role: 'assistant', reply: result.reply, questions: result.questions, ready: result.ready }],
    result.plan,
  )
}
