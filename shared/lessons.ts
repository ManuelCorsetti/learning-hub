// Lesson blocks, version 1. One Zod definition shared by the API, the AI call and the React widgets.
// See docs/phase-2-3-plan.md → "Content model (blocks)".
import { z } from 'zod'
import { DIAGRAM_KEYS, INTERACTIVE_BLOCK_TYPES, TEACHING_BLOCK_TYPES, type BlockType } from './domain'

export const LESSON_SCHEMA_VERSION = 1

/** The marker a fill_in_blank sentence uses for its one gap. */
export const BLANK = '___'

const text = z.string().trim().min(1)

/** Builds every block schema around an id schema, so the AI variant can leave ids out. */
function blockSchemas<Id extends z.ZodType>(id: Id) {
  const concept = z.object({
    type: z.literal('concept'),
    id,
    title: text,
    body_markdown: text,
    callout: z.string().nullable().optional().describe('Optional one-line takeaway shown under the body'),
  })
  const steps = z.object({
    type: z.literal('steps'),
    id,
    title: text,
    intro: z.string().nullable().optional(),
    steps: z.array(z.object({ title: text, text: text })).min(2),
  })
  const diagram = z.object({
    type: z.literal('diagram'),
    id,
    diagram_key: z.enum(DIAGRAM_KEYS),
    caption: z.string().nullable().optional(),
  })
  const quiz_mcq = z.object({
    type: z.literal('quiz_mcq'),
    id,
    question: text,
    options: z.array(text).length(4),
    correct_index: z.number().int().min(0).max(3),
    pitfall_note: text,
  })
  const quiz_true_false = z.object({
    type: z.literal('quiz_true_false'),
    id,
    statement: text,
    answer: z.boolean(),
    pitfall_note: text,
  })
  const fill_in_blank = z.object({
    type: z.literal('fill_in_blank'),
    id,
    sentence: text.describe(`Contains exactly one ${BLANK}`),
    acceptable_answers: z.array(text).min(1),
  })
  const code_challenge = z.object({
    type: z.literal('code_challenge'),
    id,
    language: text,
    question: text.describe('What to work out from the snippet, e.g. "What does this query return?"'),
    snippet: text,
    expected_answer: text,
    acceptable_answers: z
      .array(text)
      .default([])
      .describe('Other forms of the answer that are equally right (different but equivalent wording or syntax); may be empty'),
    hint: text,
  })
  const ordering = z.object({
    type: z.literal('ordering'),
    id,
    prompt: text,
    items_shuffled: z.array(text).min(3),
    correct_order: z.array(text).min(3),
  })
  const project_prompt = z.object({
    type: z.literal('project_prompt'),
    id,
    description: text,
    success_criteria: z.array(text).min(1),
  })
  const teaching = [concept, steps, diagram] as const
  const questions = [quiz_mcq, quiz_true_false, fill_in_blank, code_challenge, ordering] as const
  return { teaching, questions, project_prompt }
}

const stored = blockSchemas(text)
export const Block = z.discriminatedUnion('type', [...stored.teaching, ...stored.questions, stored.project_prompt])
export type Block = z.infer<typeof Block>
export type BlockOf<T extends BlockType> = Extract<Block, { type: T }>
export type TeachingBlock = BlockOf<(typeof TEACHING_BLOCK_TYPES)[number]>
export type InteractiveBlock = BlockOf<(typeof INTERACTIVE_BLOCK_TYPES)[number]>

export const Lesson = z.object({ schema_version: z.literal(LESSON_SCHEMA_VERSION), title: text, blocks: z.array(Block) })
export type Lesson = z.infer<typeof Lesson>

// What Claude returns. The server sets the topic and schema_version, and fills in missing ids.
const generated = blockSchemas(z.string().nullable().describe('Leave null; the server assigns ids'))
/** Any block as Claude writes it: id may be null. */
export const GeneratedBlock = z.discriminatedUnion('type', [...generated.teaching, ...generated.questions, generated.project_prompt])
export type GeneratedBlock = z.infer<typeof GeneratedBlock>
/**
 * A lesson as Claude edits it: the full block list, where "keep" stands for an unchanged block.
 * Same shape as GeneratedLesson (one union of block types, never nested), which the API accepts.
 */
const edited = blockSchemas(
  z.string().nullable().describe('The current id when this block replaces one and, for a question, still tests the same thing; null for a new block'),
)
export const EditedBlock = z.discriminatedUnion('type', [
  z.object({ type: z.literal('keep'), id: text.describe('id of an unchanged block of the current lesson') }),
  ...edited.teaching,
  ...edited.questions,
  edited.project_prompt,
])
export type EditedBlock = z.infer<typeof EditedBlock>

/** A question as Claude writes it (no project). */
export const GeneratedQuestion = z.discriminatedUnion('type', [...generated.questions])
export const GeneratedLesson = z.object({ title: text, blocks: z.array(GeneratedBlock) })
export type GeneratedLesson = z.infer<typeof GeneratedLesson>

/** Questions for a lesson that only has teaching blocks (e.g. an imported article). */
export const GeneratedQuestions = z.object({
  questions: z.array(
    z.object({
      after_block_id: text.describe('id of the teaching block this question follows'),
      block: GeneratedQuestion,
    }),
  ),
  project_prompt: generated.project_prompt,
})
export type GeneratedQuestions = z.infer<typeof GeneratedQuestions>

const TEACHING = new Set<string>(TEACHING_BLOCK_TYPES)
export const isTeaching = (b: { type: string }): b is TeachingBlock => TEACHING.has(b.type)
export const isInteractive = (b: { type: string }): b is InteractiveBlock => !TEACHING.has(b.type)
/** project_prompt is logged but never scheduled and never counts towards mastery. */
export const isScheduledType = (type: string): boolean => !TEACHING.has(type) && type !== 'project_prompt'

const sameOrder = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])

/**
 * The rules a lesson must follow beyond its schema. A lesson with no interactive
 * blocks (an imported article) is valid; once it has questions it needs exactly one
 * project_prompt, at the end. A placement test has no project (`requireProject: false`).
 */
export function lessonProblems(
  blocks: { type: string; id: string | null }[],
  { requireProject = true }: { requireProject?: boolean } = {},
): string[] {
  const problems: string[] = []
  const typed = blocks as Block[]
  const ids = new Set<string>()
  let seenTeaching = false
  typed.forEach((b, i) => {
    const where = `block ${i + 1} (${b.type})`
    if (b.id) {
      if (ids.has(b.id)) problems.push(`${where}: id "${b.id}" is used twice`)
      ids.add(b.id)
    }
    if (isTeaching(b)) seenTeaching = true
    else if (!seenTeaching) problems.push(`${where}: an interactive block must come after at least one teaching block`)
    if (b.type === 'fill_in_blank' && b.sentence.split(BLANK).length !== 2) {
      problems.push(`${where}: the sentence must contain exactly one ${BLANK}`)
    }
    if (b.type === 'ordering') {
      const items = b.items_shuffled
      if (new Set(items).size !== items.length) problems.push(`${where}: items_shuffled has duplicates`)
      const sorted = (xs: string[]) => [...xs].sort()
      if (!sameOrder(sorted(items), sorted(b.correct_order))) {
        problems.push(`${where}: correct_order must be a permutation of items_shuffled`)
      } else if (sameOrder(items, b.correct_order)) {
        problems.push(`${where}: items_shuffled is already in the correct order; shuffle it`)
      }
    }
    if (b.type === 'quiz_mcq' && new Set(b.options.map((o) => o.toLowerCase())).size !== b.options.length) {
      problems.push(`${where}: options must be distinct`)
    }
  })
  const interactive = typed.filter(isInteractive)
  const prompts = typed.filter((b) => b.type === 'project_prompt')
  if (!requireProject) {
    if (prompts.length) problems.push('a placement test has no project_prompt')
  } else if (interactive.length) {
    if (prompts.length !== 1) problems.push(`the lesson needs exactly one project_prompt, found ${prompts.length}`)
    else if (typed.at(-1)?.type !== 'project_prompt') problems.push('the project_prompt must be the last block')
  }
  return problems
}

// ---------- Answers ----------

export const Answers = {
  quiz_mcq: z.object({ choice: z.number().int().min(0).max(3) }),
  quiz_true_false: z.object({ value: z.boolean() }),
  fill_in_blank: z.object({ text: z.string().max(500) }),
  code_challenge: z.object({ text: z.string().max(5000) }),
  ordering: z.object({ order: z.array(z.string()).max(50) }),
  project_prompt: z.object({ checked: z.array(z.number().int().min(0)).max(50) }),
} satisfies Record<InteractiveBlock['type'], z.ZodType>
export type AnswerOf<T extends InteractiveBlock['type']> = z.infer<(typeof Answers)[T]>
export type Answer = { [T in InteractiveBlock['type']]: AnswerOf<T> }[InteractiveBlock['type']]
