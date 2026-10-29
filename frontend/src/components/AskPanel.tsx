// Select any text, then ask Claude about it. A button appears next to the selection; the panel
// keeps the questions and answers until the page changes. Nothing is saved, so on a lesson an
// answer can be turned into a note, which goes through Notes & edits as usual.
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { AskAnswer, AskInput } from '../../../shared/api'
import { api } from '../api'
import type { Route } from '../router'
import { Markdown } from './lesson/Markdown'

/** Fired with { blockId, draft } to open Notes & edits on the lesson page. */
export const NOTE_EVENT = 'learning-studio:note'
export type NoteEventDetail = { blockId: string | null; draft: string }

interface Quote {
  text: string
  blockId: string | null
}

interface Exchange {
  selection: string
  question: string
  answer: string
  follow_ups: string[]
  blockId: string | null
}

const STARTERS = ['Explain this more simply', 'Give me a concrete example', 'Why does this matter?', 'How does this connect to what I already know?']

function askContext(route: Route, blockId: string | null): AskInput['context'] {
  switch (route.page) {
    case 'lesson':
      return { lesson_id: route.lessonId, block_id: blockId }
    case 'topic':
      return { topic_id: route.topicId }
    case 'area':
      return { area_id: route.areaId === 'inbox' ? null : route.areaId, topic_id: route.topicId }
    default:
      return {}
  }
}

/** The current text selection inside the page (or an answer in this panel), with where to put the button. */
function useSelection(enabled: boolean) {
  const [selection, setSelection] = useState<(Quote & { x: number; y: number; below: boolean }) | null>(null)
  useEffect(() => {
    if (!enabled) {
      setSelection(null)
      return
    }
    let timer: ReturnType<typeof setTimeout>
    const update = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        const sel = window.getSelection()
        const text = sel?.toString().trim() ?? ''
        if (!sel || sel.isCollapsed || !sel.rangeCount || text.length < 2) return setSelection(null)
        const range = sel.getRangeAt(0)
        const node = range.commonAncestorContainer
        const el = node instanceof Element ? node : node.parentElement
        if (!el?.closest('main, .ask-panel .chat-msg') || el.closest('input, textarea, select')) return setSelection(null)
        const rect = range.getBoundingClientRect()
        const below = rect.top < 56
        setSelection({
          text: text.slice(0, 4000),
          blockId: el.closest('[data-block-id]')?.getAttribute('data-block-id') ?? null,
          x: Math.min(Math.max(rect.left + rect.width / 2, 70), window.innerWidth - 70),
          y: below ? rect.bottom + 8 : rect.top - 8,
          below,
        })
      }, 120)
    }
    document.addEventListener('selectionchange', update)
    window.addEventListener('scroll', update, true)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('selectionchange', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [enabled])
  return [selection, () => setSelection(null)] as const
}

export function AskSelection({ route, aiAvailable }: { route: Route; aiAvailable: boolean }) {
  // Asking during Practice would defeat the point of recalling the answer.
  const [selection, clearSelection] = useSelection(aiAvailable && route.page !== 'practice')
  const [open, setOpen] = useState(false)
  const [quote, setQuote] = useState<Quote | null>(null)
  const [thread, setThread] = useState<Exchange[]>([])

  const ask = () => {
    if (!selection) return
    setQuote({ text: selection.text, blockId: selection.blockId })
    setOpen(true)
    window.getSelection()?.removeAllRanges()
    clearSelection()
  }

  return (
    <>
      {selection && (
        <button
          className={`ask-float ${selection.below ? 'below' : ''}`}
          style={{ left: selection.x, top: selection.y }}
          // Keep the selection when the button is pressed.
          onMouseDown={(e) => e.preventDefault()}
          onClick={ask}
        >
          ✦ Ask Claude
        </button>
      )}
      {open && (
        <AskPanel
          route={route}
          quote={quote}
          setQuote={setQuote}
          thread={thread}
          setThread={setThread}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

function AskPanel({
  route,
  quote,
  setQuote,
  thread,
  setThread,
  onClose,
}: {
  route: Route
  quote: Quote | null
  setQuote: (q: Quote | null) => void
  thread: Exchange[]
  setThread: (t: Exchange[]) => void
  onClose: () => void
}) {
  const [text, setText] = useState('')
  const [asking, setAsking] = useState<{ selection: string; question: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const end = useRef<HTMLDivElement>(null)
  // A follow-up without a new selection is about the last one.
  const last = thread.at(-1)
  const about = quote ?? (last ? { text: last.selection, blockId: last.blockId } : null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  useEffect(() => {
    input.current?.focus()
  }, [quote])
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [thread.length, asking])

  const send = async (question: string) => {
    if (!about || !question.trim() || asking) return
    setAsking({ selection: about.text, question })
    setError(null)
    setText('')
    try {
      const out = await api.postRead<AskAnswer>('/ask', {
        selection: about.text,
        question,
        context: askContext(route, about.blockId),
        history: thread.slice(-6).map(({ selection, question, answer }) => ({ selection, question, answer })),
      } satisfies AskInput)
      setThread([...thread, { selection: about.text, question, answer: out.answer, follow_ups: out.follow_ups, blockId: about.blockId }])
      setQuote(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setText(question)
    } finally {
      setAsking(null)
    }
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    void send(text)
  }
  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send(text)
    }
  }
  const toNote = (x: Exchange) => {
    const draft = `While reading "${x.selection.slice(0, 300)}" I asked: ${x.question}\n\nClaude explained: ${x.answer.slice(0, 1500)}\n\nMake the lesson clearer on this.`
    window.dispatchEvent(new CustomEvent<NoteEventDetail>(NOTE_EVENT, { detail: { blockId: x.blockId, draft } }))
    onClose()
  }

  return (
    <aside className="panel ask-panel" aria-label="Ask Claude">
      <div className="panel-head">
        <h2>Ask Claude</h2>
        <button className="icon-btn close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <p className="small muted">
        Select any text on the page and ask about it. Answers are not saved{route.page === 'lesson' && '; turn one into a note to improve the lesson'}.
      </p>
      <div className="stack">
        {thread.map((x, i) => (
          <div key={i} className="stack">
            {(i === 0 || thread[i - 1].selection !== x.selection) && <blockquote className="ask-quote">{x.selection}</blockquote>}
            <div className="chat-msg user">{x.question}</div>
            <div className="chat-msg assistant">
              <Markdown text={x.answer} />
              {route.page === 'lesson' && (
                <button className="btn link small ask-note" onClick={() => toNote(x)}>
                  ✎ Turn into a note on the lesson
                </button>
              )}
            </div>
            {i === thread.length - 1 && !quote && !asking && x.follow_ups.length > 0 && (
              <div className="chip-row">
                {x.follow_ups.map((f) => (
                  <button key={f} className="chip ask-chip" onClick={() => send(f)}>
                    {f}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        {asking && (
          <>
            {asking.selection !== thread.at(-1)?.selection && <blockquote className="ask-quote">{asking.selection}</blockquote>}
            <div className="chat-msg user">{asking.question}</div>
            <p className="working">
              <span className="spinner" /> Claude is reading the page.
            </p>
          </>
        )}
        <div ref={end} />
      </div>
      <form className="stack ask-form" onSubmit={submit}>
        {quote && !asking && (
          <>
            <div className="ask-quote-row">
              <blockquote className="ask-quote">{quote.text}</blockquote>
              {thread.length > 0 && (
                <button type="button" className="icon-btn" onClick={() => setQuote(null)} aria-label="Ask about the previous selection instead">
                  ×
                </button>
              )}
            </div>
            <div className="chip-row">
              {STARTERS.map((s) => (
                <button key={s} type="button" className="chip ask-chip" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </>
        )}
        {!about && <p className="small muted">Select some text on the page first.</p>}
        <textarea
          ref={input}
          rows={2}
          value={text}
          disabled={!about || Boolean(asking)}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={quote ? 'What do you want to know about this?' : 'Ask a follow-up'}
        />
        <div>
          <button className="btn small primary" disabled={!about || Boolean(asking) || !text.trim()}>
            Ask
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </form>
    </aside>
  )
}
