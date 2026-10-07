// Question widgets. Each one edits a draft answer; QuestionCard asks for confidence before
// the answer is checked, then shows the result and the pitfall note.
import { useState } from 'react'
import { CONFIDENCE_LABELS, CONFIDENCES, type Confidence } from '../../../../shared/domain'
import type { AttemptResult, ItemProgress } from '../../../../shared/api'
import { BLANK, type BlockOf, type InteractiveBlock } from '../../../../shared/lessons'
import { useAction } from '../../api'
import { Inline } from './Markdown'
import { relativeTime } from '../status'

export type SubmitAttempt = (answer: unknown, confidence: Confidence | null) => Promise<AttemptResult>

const KIND_LABELS: Record<InteractiveBlock['type'], string> = {
  quiz_mcq: 'Multiple choice',
  quiz_true_false: 'True or false',
  fill_in_blank: 'Fill in the blank',
  code_challenge: 'Code',
  ordering: 'Put in order',
  project_prompt: 'Project',
}

type Draft = number | boolean | string | string[] | number[] | null

function emptyDraft(block: InteractiveBlock): Draft {
  if (block.type === 'ordering') return [...block.items_shuffled]
  if (block.type === 'project_prompt') return []
  if (block.type === 'fill_in_blank' || block.type === 'code_challenge') return ''
  return null
}

function toAnswer(block: InteractiveBlock, draft: Draft): unknown {
  switch (block.type) {
    case 'quiz_mcq':
      return draft === null ? null : { choice: draft }
    case 'quiz_true_false':
      return draft === null ? null : { value: draft }
    case 'fill_in_blank':
    case 'code_challenge':
      return (draft as string).trim() ? { text: draft } : null
    case 'ordering':
      return { order: draft }
    case 'project_prompt':
      return { checked: draft }
  }
}

export function QuestionCard({
  block,
  progress,
  onSubmit,
}: {
  block: InteractiveBlock
  progress?: ItemProgress
  onSubmit: SubmitAttempt
}) {
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(block))
  const [result, setResult] = useState<AttemptResult | null>(null)
  const { busy, error, run } = useAction()
  const answer = toAnswer(block, draft)
  const locked = Boolean(result) || busy

  const submit = async (confidence: Confidence | null) => {
    const res = await run(() => onSubmit(answer, confidence))
    if (res) setResult(res)
  }
  const reset = () => {
    setDraft(emptyDraft(block))
    setResult(null)
  }
  const verdict = !result ? '' : result.is_correct === null ? 'logged' : result.is_correct ? 'right' : result.score >= 0.5 ? 'partly' : 'wrong'

  return (
    <div className={`question ${verdict}`}>
      <div className="q-head">
        <span className="q-kind">{KIND_LABELS[block.type]}</span>
        {progress && !result && <ProgressNote progress={progress} />}
      </div>
      <Widget block={block} draft={draft} setDraft={setDraft} locked={locked} result={result} />
      {!result &&
        (block.type === 'project_prompt' ? (
          <div className="row q-actions">
            <button className="btn small primary" disabled={busy} onClick={() => submit(null)}>
              Log progress
            </button>
          </div>
        ) : (
          <div className="q-actions">
            <span className="small muted">How sure are you?</span>
            <div className="row">
              {CONFIDENCES.map((c) => (
                <button key={c} className="btn small" disabled={busy || answer === null} onClick={() => submit(c)}>
                  {CONFIDENCE_LABELS[c]}
                </button>
              ))}
            </div>
          </div>
        ))}
      {result && <Feedback block={block} result={result} onRetry={reset} />}
      {error && <p className="error">{error}</p>}
    </div>
  )
}

function ProgressNote({ progress }: { progress: ItemProgress }) {
  if (!progress.attempts) return <span className="q-meta">New</span>
  const last = progress.last_correct === null ? '' : progress.last_correct ? 'last answer right' : 'last answer wrong'
  const due = progress.due_at ? ` · review ${relativeTime(progress.due_at)}` : ''
  return (
    <span className="q-meta">
      {last}
      {due}
    </span>
  )
}

interface WidgetProps<T extends InteractiveBlock['type']> {
  block: BlockOf<T>
  draft: Draft
  setDraft: (d: Draft) => void
  locked: boolean
  result: AttemptResult | null
}

function Widget(props: WidgetProps<InteractiveBlock['type']>) {
  const { block } = props
  switch (block.type) {
    case 'quiz_mcq':
      return <Mcq {...(props as WidgetProps<'quiz_mcq'>)} />
    case 'quiz_true_false':
      return <TrueFalse {...(props as WidgetProps<'quiz_true_false'>)} />
    case 'fill_in_blank':
      return <FillInBlank {...(props as WidgetProps<'fill_in_blank'>)} />
    case 'code_challenge':
      return <CodeChallenge {...(props as WidgetProps<'code_challenge'>)} />
    case 'ordering':
      return <Ordering {...(props as WidgetProps<'ordering'>)} />
    case 'project_prompt':
      return <ProjectPrompt {...(props as WidgetProps<'project_prompt'>)} />
  }
}

function Mcq({ block, draft, setDraft, locked, result }: WidgetProps<'quiz_mcq'>) {
  return (
    <>
      <p className="q-text">
        <Inline text={block.question} />
      </p>
      <div className="options" role="radiogroup">
        {block.options.map((o, i) => {
          const mark = result ? (i === block.correct_index ? 'correct' : i === draft ? 'chosen-wrong' : '') : ''
          return (
            <button
              key={i}
              role="radio"
              aria-checked={draft === i}
              className={`option ${draft === i ? 'selected' : ''} ${mark}`}
              disabled={locked}
              onClick={() => setDraft(i)}
            >
              <span className="letter">{'ABCD'[i]}</span>
              <span>
                <Inline text={o} />
              </span>
            </button>
          )
        })}
      </div>
    </>
  )
}

function TrueFalse({ block, draft, setDraft, locked, result }: WidgetProps<'quiz_true_false'>) {
  return (
    <>
      <p className="q-text">
        <Inline text={block.statement} />
      </p>
      <div className="row" role="radiogroup">
        {[true, false].map((v) => {
          const mark = result ? (v === block.answer ? 'correct' : v === draft ? 'chosen-wrong' : '') : ''
          return (
            <button
              key={String(v)}
              role="radio"
              aria-checked={draft === v}
              className={`option tf ${draft === v ? 'selected' : ''} ${mark}`}
              disabled={locked}
              onClick={() => setDraft(v)}
            >
              {v ? 'True' : 'False'}
            </button>
          )
        })}
      </div>
    </>
  )
}

function FillInBlank({ block, draft, setDraft, locked }: WidgetProps<'fill_in_blank'>) {
  const [before, after = ''] = block.sentence.split(BLANK)
  return (
    <p className="q-text fill">
      <Inline text={before} />
      <input
        aria-label="Your answer"
        value={draft as string}
        disabled={locked}
        onChange={(e) => setDraft(e.target.value)}
        size={Math.max(8, (draft as string).length + 2)}
      />
      <Inline text={after} />
    </p>
  )
}

function CodeChallenge({ block, draft, setDraft, locked, result }: WidgetProps<'code_challenge'>) {
  const [hint, setHint] = useState(false)
  return (
    <>
      <p className="q-text">
        <Inline text={block.question} />
      </p>
      <pre className="code-block">
        <span className="lang">{block.language}</span>
        <code>{block.snippet}</code>
      </pre>
      <textarea
        aria-label="Your answer"
        className="code-answer"
        rows={2}
        value={draft as string}
        disabled={locked}
        onChange={(e) => setDraft(e.target.value)}
      />
      {!result &&
        (hint ? (
          <p className="small muted">Hint: {block.hint}</p>
        ) : (
          <button className="btn link small" onClick={() => setHint(true)}>
            Show hint
          </button>
        ))}
    </>
  )
}

function Ordering({ block, draft, setDraft, locked, result }: WidgetProps<'ordering'>) {
  const order = draft as string[]
  const move = (i: number, by: number) => {
    const next = [...order]
    ;[next[i], next[i + by]] = [next[i + by], next[i]]
    setDraft(next)
  }
  return (
    <>
      <p className="q-text">
        <Inline text={block.prompt} />
      </p>
      <ol className="ordering">
        {order.map((item, i) => (
          <li key={item} className={result ? (block.correct_order[i] === item ? 'correct' : 'chosen-wrong') : ''}>
            <span className="grow">
              <Inline text={item} />
            </span>
            <button className="icon-btn" disabled={locked || i === 0} onClick={() => move(i, -1)} aria-label="Move up">
              ↑
            </button>
            <button
              className="icon-btn"
              disabled={locked || i === order.length - 1}
              onClick={() => move(i, 1)}
              aria-label="Move down"
            >
              ↓
            </button>
          </li>
        ))}
      </ol>
    </>
  )
}

function ProjectPrompt({ block, draft, setDraft, locked }: WidgetProps<'project_prompt'>) {
  const checked = new Set(draft as number[])
  const toggle = (i: number) => setDraft(checked.has(i) ? [...checked].filter((x) => x !== i) : [...checked, i])
  return (
    <>
      <p className="q-text">
        <Inline text={block.description} />
      </p>
      <ul className="criteria">
        {block.success_criteria.map((c, i) => (
          <li key={i}>
            <label>
              <input type="checkbox" checked={checked.has(i)} disabled={locked} onChange={() => toggle(i)} />
              <Inline text={c} />
            </label>
          </li>
        ))}
      </ul>
    </>
  )
}

function Feedback({ block, result, onRetry }: { block: InteractiveBlock; result: AttemptResult; onRetry: () => void }) {
  const head =
    result.is_correct === null
      ? `Logged: ${Math.round(result.score * 100)}% of the criteria met. Projects are not scheduled.`
      : result.is_correct
        ? 'Correct.'
        : result.score >= 0.5
          ? `Partly right (${Math.round(result.score * 100)}%).`
          : 'Not quite.'
  return (
    <div className="feedback">
      <b>{head}</b>
      {result.confidently_wrong && <span className="small"> You were certain, so this one is worth a closer look.</span>}
      {(block.type === 'quiz_mcq' || block.type === 'quiz_true_false') && (
        <p>
          <Inline text={block.pitfall_note} />
        </p>
      )}
      {block.type === 'fill_in_blank' && !result.is_correct && (
        <p>Accepted: {block.acceptable_answers.join(' · ')}</p>
      )}
      {block.type === 'code_challenge' && (
        <p>
          Expected: <code>{block.expected_answer}</code>
          {!result.is_correct && <> · Hint: {block.hint}</>}
        </p>
      )}
      {block.type === 'ordering' && !result.is_correct && <p>Correct order: {block.correct_order.join(' → ')}</p>}
      <div className="row small muted">
        {result.due_at && <span>Next review {relativeTime(result.due_at)}.</span>}
        <button className="btn link small" onClick={onRetry}>
          Answer again
        </button>
      </div>
    </div>
  )
}
