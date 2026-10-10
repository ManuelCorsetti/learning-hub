// A compact, read-only view of one block, for diffs.
import type { Block } from '../../../../shared/lessons'
import { Inline, Markdown } from './Markdown'

const KIND: Record<Block['type'], string> = {
  concept: 'Concept',
  steps: 'Steps',
  diagram: 'Diagram',
  quiz_mcq: 'Multiple choice',
  quiz_true_false: 'True or false',
  fill_in_blank: 'Fill in the blank',
  code_challenge: 'Code',
  ordering: 'Ordering',
  project_prompt: 'Project',
}

export const blockKind = (b: Block) => KIND[b.type]

export function BlockPreview({ block }: { block: Block }) {
  return (
    <div className="block-preview">
      <span className="q-kind">{KIND[block.type]}</span>
      <Body block={block} />
    </div>
  )
}

function Body({ block: b }: { block: Block }) {
  switch (b.type) {
    case 'concept':
      return (
        <>
          <b>{b.title}</b>
          <Markdown text={b.body_markdown} />
          {b.callout && (
            <p className="muted">
              ✦ <Inline text={b.callout} />
            </p>
          )}
        </>
      )
    case 'steps':
      return (
        <>
          <b>{b.title}</b>
          {b.intro && <p>{b.intro}</p>}
          <ol>
            {b.steps.map((s, i) => (
              <li key={i}>
                <b>{s.title}</b>: {s.text}
              </li>
            ))}
          </ol>
        </>
      )
    case 'diagram':
      return <p>{b.diagram_key}{b.caption ? ` · ${b.caption}` : ''}</p>
    case 'quiz_mcq':
      return (
        <>
          <p>
            <Inline text={b.question} />
          </p>
          <ol type="A">
            {b.options.map((o, i) => (
              <li key={i} className={i === b.correct_index ? 'right' : ''}>
                <Inline text={o} />
              </li>
            ))}
          </ol>
          <p className="muted">{b.pitfall_note}</p>
        </>
      )
    case 'quiz_true_false':
      return (
        <>
          <p>
            <Inline text={b.statement} /> <b className="right">{b.answer ? 'True' : 'False'}</b>
          </p>
          <p className="muted">{b.pitfall_note}</p>
        </>
      )
    case 'fill_in_blank':
      return (
        <p>
          <Inline text={b.sentence} /> <b className="right">{b.acceptable_answers.join(' · ')}</b>
        </p>
      )
    case 'code_challenge':
      return (
        <>
          <p>{b.question}</p>
          <pre className="code-block">
            <code>{b.snippet}</code>
          </pre>
          <p>
            Expected: <code>{b.expected_answer}</code>
          </p>
        </>
      )
    case 'ordering':
      return (
        <>
          <p>{b.prompt}</p>
          <p className="right">{b.correct_order.join(' → ')}</p>
        </>
      )
    case 'project_prompt':
      return (
        <>
          <p>{b.description}</p>
          <ul>
            {b.success_criteria.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </>
      )
  }
}
