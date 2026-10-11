// Free-text grading: when the exact check marks a fill-in-the-blank or code answer wrong, a small
// model reads it and says whether it is wrong in substance or only different in form. If Claude is
// unavailable the exact result stands. The result feeds the same rating rules as any other answer.
import { z } from 'zod'
import type { AttemptInput, AttemptResult } from '../../../shared/api'
import type { InteractiveBlock } from '../../../shared/lessons'
import type { Db } from '../db/connection'
import { attemptContext, recordAttempt } from '../services/practice'
import { acceptedAnswers, grade, isFreeText, parseAnswer, type AiGrade, type Grade } from '../services/grading'
import { callStructured } from './client'

export const GRADER_MODEL = 'claude-haiku-5-5'

export const AnswerGrade = z.object({
  verdict: z.enum(['correct', 'partly', 'wrong']),
  score: z.number().min(0).max(1).describe('correct 0.8 to 1, partly 0.5 to 0.89, wrong 0 to 0.49'),
  feedback: z.string().min(1).max(300).describe('One short sentence to the person'),
})
export type AnswerGrade = z.infer<typeof AnswerGrade>

const BANDS = { correct: [0.8, 1], partly: [0.5, 0.89], wrong: [0, 0.49] } as const

export function gradeProblems(out: AnswerGrade): string[] {
  const [low, high] = BANDS[out.verdict]
  return out.score >= low && out.score <= high ? [] : [`a "${out.verdict}" verdict needs a score from ${low} to ${high}, got ${out.score}`]
}

/** The verdict as a Grade for rate(): only "correct" counts as right; "partly" scores 0.5 or more and so rates Hard. */
export const toGrade = (out: AnswerGrade): Grade => ({ is_correct: out.verdict === 'correct', score: out.score })

function gradingInput(block: Extract<InteractiveBlock, { type: 'fill_in_blank' | 'code_challenge' }>, text: string) {
  const [expected, ...acceptable] = acceptedAnswers(block)
  return block.type === 'fill_in_blank'
    ? { kind: block.type, question: block.sentence, expected, acceptable, answer: text }
    : { kind: block.type, question: block.question, language: block.language, snippet: block.snippet, expected, acceptable, answer: text }
}

/** Claude's reading of an answer the exact check rejected, or null when it cannot be had. */
export async function aiGrade(db: Db, block: InteractiveBlock, answer: unknown): Promise<{ grade: Grade; info: AiGrade } | null> {
  if (!isFreeText(block)) return null
  try {
    const text = parseAnswer(block.type, answer).text
    const { runId, result } = await callStructured(db, {
      task: 'grade_answer',
      promptName: 'answer_grader',
      schema: AnswerGrade,
      input: gradingInput(block, text),
      check: gradeProblems,
      model: GRADER_MODEL,
      effort: 'low',
      profile: false,
    })
    return { grade: toGrade(result), info: { run_id: runId, model: GRADER_MODEL, verdict: result.verdict, feedback: result.feedback } }
  } catch (err) {
    console.warn(`[ai] grade_answer unavailable, keeping the exact result: ${err instanceof Error ? err.message : err}`)
    return null
  }
}

/** Records an attempt, asking Claude to grade a free-text answer the exact check marked wrong. */
export async function recordGradedAttempt(
  db: Db,
  input: z.infer<typeof AttemptInput>,
  { available, now = new Date() }: { available: boolean; now?: Date },
): Promise<AttemptResult> {
  const { block } = attemptContext(db, input)
  const exact = grade(block, input.answer)
  const ai = exact.is_correct === false && available ? await aiGrade(db, block, input.answer) : null
  return recordAttempt(db, input, now, ai ?? undefined)
}
