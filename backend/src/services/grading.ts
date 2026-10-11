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

/** How a free-text answer was graded when the exact check failed and Claude looked at it. */
export interface AiGrade {
  run_id: string
  model: string
  verdict: 'correct' | 'partly' | 'wrong'
  feedback: string
}

const squash = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()

/**
 * Free-text compare: case, whitespace, spaces around punctuation, trailing semicolons and the
 * choice between ' and " don't count.
 */
export const normaliseCode = (s: string) =>
  squash(s)
    .replace(/"/g, "'")
    .replace(/\s*([^\w\s])\s*/g, '$1')
    .replace(/;+$/, '')

/** The forms of a free-text answer that count as right. */
export const acceptedAnswers = (block: InteractiveBlock): string[] =>
  block.type === 'fill_in_blank'
    ? block.acceptable_answers
    : block.type === 'code_challenge'
      ? [block.expected_answer, ...block.acceptable_answers]
      : []

/** Blocks whose answer is free text, so a near miss is worth a second look. */
export const isFreeText = (block: InteractiveBlock): block is Extract<InteractiveBlock, { type: 'fill_in_blank' | 'code_challenge' }> =>
  block.type === 'fill_in_blank' || block.type === 'code_challenge'

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
    case 'fill_in_blank':
    case 'code_challenge': {
      const given = normaliseCode(parseAnswer(block.type, answer).text)
      return exact(acceptedAnswers(block).some((a) => normaliseCode(a) === given))
    }
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
