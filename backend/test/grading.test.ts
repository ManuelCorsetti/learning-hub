import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Block, type Block as BlockType, type InteractiveBlock } from '../../shared/lessons'
import type { AttemptResult } from '../../shared/api'
import { USER } from '../src/services/events'
import { get, openDb, type Db } from '../src/db/connection'
import { createLesson } from '../src/services/lessons'
import { grade, normaliseCode } from '../src/services/grading'
import { startSession } from '../src/services/practice'
import { createTopic } from '../src/services/topics'

const callStructured = vi.fn()
vi.mock('../src/ai/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/ai/client')>()),
  callStructured: (...args: unknown[]) => callStructured(...args),
}))
const { AnswerGrade, gradeProblems, recordGradedAttempt } = await import('../src/ai/gradeAnswer')

const code = (acceptable: string[] = []): Extract<InteractiveBlock, { type: 'code_challenge' }> => ({
  type: 'code_challenge',
  id: 'q-code',
  language: 'python',
  question: 'Complete the call that builds a point with x as the string 3 and y as 0.',
  snippet: 'Point(...)',
  expected_answer: "Point(x='3', y=0)",
  acceptable_answers: acceptable,
  hint: 'Keyword arguments',
})
const fill: InteractiveBlock = { type: 'fill_in_blank', id: 'q-fill', sentence: 'The file is called ___.', acceptable_answers: ["profiles.yml"] }

describe('exact free-text check', () => {
  it('treats single and double quotes as the same', () => {
    expect(grade(code(), { text: 'Point(x="3", y=0)' }).is_correct).toBe(true)
    expect(grade(code(), { text: "Point(x='3',y=0);" }).is_correct).toBe(true)
    expect(grade(code(), { text: '  point( x = "3" ,\n y=0 )  ;; ' }).is_correct).toBe(true)
    expect(grade(code(), { text: 'Point(x=3, y=0)' }).is_correct).toBe(false)
    expect(normaliseCode('say("hi");')).toBe(normaliseCode("say('hi')"))
  })
  it('accepts any of the listed forms for a code question', () => {
    const block = code(['Point("3", 0)'])
    expect(grade(block, { text: "Point('3', 0)" }).is_correct).toBe(true)
    expect(grade(block, { text: 'Point(3, 0)' }).is_correct).toBe(false)
  })
  it('applies the same rules to fill-in-the-blank', () => {
    expect(grade(fill, { text: ' Profiles.YML. ' }).is_correct).toBe(false)
    expect(grade(fill, { text: ' Profiles.YML ' }).is_correct).toBe(true)
  })
  it('still reads lessons saved before acceptable_answers existed', () => {
    const { acceptable_answers: _, ...old } = code()
    expect(Block.parse(old)).toMatchObject({ acceptable_answers: [] })
  })
})

describe('AI grade schema', () => {
  it('is a small flat grammar, and keeps verdict and score consistent', () => {
    expect(JSON.stringify(betaZodOutputFormat(AnswerGrade).schema)).not.toContain('anyOf')
    expect(gradeProblems({ verdict: 'correct', score: 0.95, feedback: 'x' })).toEqual([])
    expect(gradeProblems({ verdict: 'partly', score: 0.6, feedback: 'x' })).toEqual([])
    expect(gradeProblems({ verdict: 'wrong', score: 0.2, feedback: 'x' })).toEqual([])
    expect(gradeProblems({ verdict: 'correct', score: 0.5, feedback: 'x' })[0]).toMatch(/needs a score/)
    expect(gradeProblems({ verdict: 'wrong', score: 0.7, feedback: 'x' })[0]).toMatch(/needs a score/)
  })
})

describe('recording a free-text answer', () => {
  let db: Db
  let session: string
  let item: string
  const attempt = (answer: unknown, available = true, confidence: 1 | 2 | 3 = 2): Promise<AttemptResult> =>
    recordGradedAttempt(db, { session_id: session, review_item_id: item, answer, confidence }, { available })
  const storedAnswer = () => JSON.parse(get<{ answer_json: string }>(db, 'SELECT answer_json FROM attempts')!.answer_json)

  beforeEach(() => {
    callStructured.mockReset()
    db = openDb(':memory:')
    const topicId = createTopic(db, USER, { title: 'Python' }).id
    const concept: BlockType = { type: 'concept', id: 'c1', title: 'Points', body_markdown: 'Text', callout: null }
    const project: BlockType = { type: 'project_prompt', id: 'p', description: 'Build', success_criteria: ['One'] }
    const { lessonId, versionId } = createLesson(db, { topicId, title: 'L', origin: 'ai', blocks: [concept, code(), project], createdBy: 'ai' })
    session = startSession(db, 'lesson', versionId)
    item = get<{ id: string }>(db, 'SELECT id FROM review_items WHERE lesson_id = ? AND block_id = ?', lessonId, 'q-code')!.id
  })

  it('does not ask Claude when the exact check passes', async () => {
    const result = await attempt({ text: 'Point(x="3", y=0)' })
    expect(result).toMatchObject({ is_correct: true, rating: 3, ai_graded: false, feedback: null })
    expect(callStructured).not.toHaveBeenCalled()
    expect(storedAnswer()).toEqual({ text: 'Point(x="3", y=0)' })
  })

  it('grades a near miss with the small model and records who graded it', async () => {
    callStructured.mockResolvedValue({ runId: 'run-1', result: { verdict: 'partly', score: 0.6, feedback: 'Right call, but y should be 0.' } })
    const result = await attempt({ text: 'Point(x="3", y=1)' })
    expect(callStructured).toHaveBeenCalledOnce()
    const call = callStructured.mock.calls[0][1]
    expect(call).toMatchObject({ task: 'grade_answer', model: 'claude-haiku-5-5', effort: 'low', profile: false })
    expect(call.input).toMatchObject({ expected: "Point(x='3', y=0)", answer: 'Point(x="3", y=1)', snippet: 'Point(...)' })
    expect(result).toMatchObject({ is_correct: false, score: 0.6, rating: 2, ai_graded: true, feedback: 'Right call, but y should be 0.' })
    expect(storedAnswer()).toMatchObject({ text: 'Point(x="3", y=1)', ai_graded: { run_id: 'run-1', verdict: 'partly', model: 'claude-haiku-5-5' } })
  })

  it('lets a correct AI verdict rate by confidence, like any right answer', async () => {
    callStructured.mockResolvedValue({ runId: 'run-2', result: { verdict: 'correct', score: 0.95, feedback: 'Same call.' } })
    expect(await attempt({ text: 'Point(y=0, x="3")' }, true, 3)).toMatchObject({ is_correct: true, rating: 4, ai_graded: true })
  })

  it('rates a wrong AI verdict Again', async () => {
    callStructured.mockResolvedValue({ runId: 'run-3', result: { verdict: 'wrong', score: 0.1, feedback: 'No.' } })
    expect(await attempt({ text: 'Line(1)' })).toMatchObject({ is_correct: false, rating: 1, ai_graded: true })
  })

  it('keeps the exact result when Claude is unavailable or fails', async () => {
    expect(await attempt({ text: 'Point(1)' }, false)).toMatchObject({ is_correct: false, rating: 1, ai_graded: false })
    expect(callStructured).not.toHaveBeenCalled()
    callStructured.mockRejectedValue(new Error('rate limited'))
    expect(await attempt({ text: 'Point(2)' })).toMatchObject({ is_correct: false, rating: 1, ai_graded: false, feedback: null })
    expect(storedAnswer()).toEqual({ text: 'Point(1)' })
  })
})
