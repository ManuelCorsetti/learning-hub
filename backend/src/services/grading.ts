// Grading and rating are pure: block + answer → result → scheduler rating.
// See docs/phase-2-3-plan.md → "Rating rules".
import type { Confidence, Rating } from '../../../shared/domain'
import { Answers, type AnswerOf, type InteractiveBlock } from '../../../shared/lessons'
import { AppError } from '../lib'

export interface Grade {
  /** null when the block is not auto-gradable (project_prompt). */
  is_correct: boolean | null
  score: number
}

const squash = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()

/** Code compare: case, whitespace, spaces around punctuation and trailing semicolons don't count. */
export const normaliseCode = (s: string) =>
  squash(s)
    .replace(/\s*([^\w\s])\s*/g, '$1')
    .replace(/;+$/, '')

export function parseAnswer<T extends InteractiveBlock['type']>(type: T, answer: unknown): AnswerOf<T> {
  const parsed = Answers[type].safeParse(answer)
  if (!parsed.success) throw new AppError(`That answer does not fit a ${type} block`)
  return parsed.data as AnswerOf<T>
}

export function grade(block: InteractiveBlock, answer: unknown): Grade {
  const exact = (ok: boolean): Grade => ({ is_correct: ok, score: ok ? 1 : 0 })
  switch (block.type) {
    case 'quiz_mcq':
      return exact(parseAnswer(block.type, answer).choice === block.correct_index)
    case 'quiz_true_false':
      return exact(parseAnswer(block.type, answer).value === block.answer)
    case 'fill_in_blank': {
      const given = squash(parseAnswer(block.type, answer).text)
      return exact(block.acceptable_answers.some((a) => squash(a) === given))
    }
    case 'code_challenge':
      return exact(normaliseCode(parseAnswer(block.type, answer).text) === normaliseCode(block.expected_answer))
    case 'ordering': {
      const { order } = parseAnswer(block.type, answer)
      const right = block.correct_order.filter((item, i) => order[i] === item).length
      const score = right / block.correct_order.length
      return { is_correct: score === 1, score }
    }
    case 'project_prompt': {
      const ticked = new Set(parseAnswer(block.type, answer).checked.filter((i) => i < block.success_criteria.length))
      return { is_correct: null, score: ticked.size / block.success_criteria.length }
    }
  }
}

/**
 * Answer → scheduler rating. Wrong (or score < 0.5) → Again; partly right → Hard;
 * correct → Hard / Good / Easy by confidence (no confidence counts as fairly sure).
 */
export function rate(result: Grade, confidence: Confidence | null): Rating | null {
  if (result.is_correct === null) return null
  if (!result.is_correct) return result.score >= 0.5 ? 2 : 1
  if (confidence === 1) return 2
  if (confidence === 3) return 4
  return 3
}

export const isConfidentlyWrong = (result: Grade, confidence: Confidence | null) =>
  result.is_correct === false && confidence === 3
