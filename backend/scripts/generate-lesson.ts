// Generates a lesson in a throwaway in-memory database and prints it for prompt review
// (build step 10 of docs/phase-2-3-plan.md). The JSON is also saved under data/lesson-samples/.
//   npm run ai:lesson                                  → a full lesson for "Change data capture"
//   npm run ai:lesson -- "Some topic title"            → a full lesson for any title (created if not seeded)
//   npm run ai:lesson -- --questions                   → questions for the imported dimensional-modelling article
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { generateLesson, generateQuestions } from '../src/ai/lessons'
import { config, ROOT } from '../src/config'
import { all, get, openDb } from '../src/db/connection'
import { seedIfEmpty } from '../src/db/seed'
import type { Block } from '../../shared/lessons'
import { importSeedArticles } from '../src/services/articles'
import { SYSTEM } from '../src/services/events'
import { getLessonView } from '../src/services/lessons'
import { createTopic } from '../src/services/topics'

const args = process.argv.slice(2)
const questionsOnly = args.includes('--questions')
const title = args.filter((a) => !a.startsWith('--')).join(' ') || (questionsOnly ? 'Dimensional modelling' : 'Change data capture')

const db = openDb(':memory:')
seedIfEmpty(db)
importSeedArticles(db)
console.log(`Model: ${config.model}\n`)

let lessonId: string
if (questionsOnly) {
  const lesson = get<{ id: string }>(db, `SELECT id FROM lessons WHERE origin = 'imported_article' AND lower(title) = lower(?)`, title)
  if (!lesson) throw new Error(`No imported article called "${title}"`)
  await generateQuestions(db, lesson.id)
  lessonId = lesson.id
} else {
  const topic =
    get<{ id: string }>(db, 'SELECT id FROM topics WHERE lower(title) = lower(?)', title) ??
    createTopic(db, SYSTEM, { title })
  lessonId = (await generateLesson(db, topic.id)).lessonId
}

const view = getLessonView(db, lessonId)
console.log(`# ${view.title}  (v${view.version.version_no}, ${view.blocks.length} blocks)\n`)
for (const b of view.blocks) console.log(describe(b) + '\n')

const [run] = all<{ attempt_count: number; input_tokens: number; output_tokens: number; latency_ms: number }>(
  db,
  'SELECT attempt_count, input_tokens, output_tokens, latency_ms FROM ai_runs',
)
console.log(`Attempts: ${run.attempt_count}, tokens in/out: ${run.input_tokens}/${run.output_tokens}, ${run.latency_ms} ms`)

const dir = join(ROOT, 'data', 'lesson-samples')
mkdirSync(dir, { recursive: true })
const file = join(dir, `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}.json`)
writeFileSync(file, JSON.stringify({ title: view.title, blocks: view.blocks }, null, 2))
console.log(`Saved ${file}`)

function describe(b: Block): string {
  switch (b.type) {
    case 'concept':
      return `## ${b.title}\n${b.body_markdown}${b.callout ? `\n> ${b.callout}` : ''}`
    case 'steps':
      return `## ${b.title}\n${b.intro ?? ''}\n${b.steps.map((s, i) => `  ${i + 1}. ${s.title}: ${s.text}`).join('\n')}`
    case 'diagram':
      return `[diagram: ${b.diagram_key}]${b.caption ? ` ${b.caption}` : ''}`
    case 'quiz_mcq':
      return `Q (mcq) ${b.question}\n${b.options.map((o, i) => `  ${i === b.correct_index ? '*' : ' '} ${o}`).join('\n')}\n  pitfall: ${b.pitfall_note}`
    case 'quiz_true_false':
      return `Q (true/false) ${b.statement}  → ${b.answer}\n  pitfall: ${b.pitfall_note}`
    case 'fill_in_blank':
      return `Q (fill) ${b.sentence}  → ${b.acceptable_answers.join(' | ')}`
    case 'code_challenge':
      return `Q (code, ${b.language}) ${b.question}\n${b.snippet}\n  → ${b.expected_answer}  (hint: ${b.hint})`
    case 'ordering':
      return `Q (ordering) ${b.prompt}\n  shown: ${b.items_shuffled.join(' · ')}\n  right: ${b.correct_order.join(' → ')}`
    case 'project_prompt':
      return `Project: ${b.description}\n${b.success_criteria.map((c) => `  [ ] ${c}`).join('\n')}`
  }
}
