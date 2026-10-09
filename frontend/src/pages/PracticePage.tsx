// Practice: every review that is due, across all topics, one at a time, in a review session.
import { useCallback, useEffect, useState } from 'react'
import type { PracticeData } from '../../../shared/api'
import { api } from '../api'
import { QuestionCard } from '../components/lesson/Questions'
import { useStudySession } from '../components/lesson/useStudySession'
import { relativeTime } from '../components/status'
import { lessonHref } from '../router'

export function PracticePage() {
  // The queue is loaded once per round, so answered items stay on screen until "Next".
  const [queue, setQueue] = useState<PracticeData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [index, setIndex] = useState(0)
  const [answered, setAnswered] = useState(false)
  const [round, setRound] = useState(0)
  const record = useStudySession('review', null)

  const load = useCallback(() => {
    api
      .get<PracticeData>('/practice')
      .then((data) => {
        setQueue(data)
        setIndex(0)
        setAnswered(false)
        setRound((r) => r + 1)
      })
      .catch((err: Error) => setError(err.message))
  }, [])
  useEffect(load, [load])

  if (error) return <p className="error">{error}</p>
  if (!queue) return <p className="muted">Loading…</p>

  const item = queue.due[index]
  const topics = new Set(queue.due.map((d) => d.topic_id)).size
  return (
    <>
      <span className="eyebrow">Practice</span>
      <h1>
        Reviews <em>due</em>
      </h1>
      <p className="lede">
        Spaced repetition: each answer sets when you see that question again. Recall it before you look; say honestly how
        sure you are.
      </p>
      <span className="summary-line">
        {queue.due.length
          ? `${queue.due.length} due across ${topics} topic${topics === 1 ? '' : 's'}`
          : 'Nothing due'}
      </span>

      {item ? (
        <section className="practice">
          <div className="practice-head">
            <span className="card-label">
              {index + 1} of {queue.due.length} ·{' '}
              {item.lesson_title !== item.topic_title && <>{item.topic_title} · </>}
              <a href={lessonHref(item.lesson_id)}>{item.lesson_title}</a>
            </span>
            {item.lapses > 0 && <span className="q-meta">forgotten {item.lapses}×</span>}
          </div>
          <QuestionCard
            key={`${round}-${item.review_item_id}`}
            block={item.block}
            onSubmit={async (answer, confidence) => {
              const result = await record(item.review_item_id, answer, confidence)
              setAnswered(true)
              return result
            }}
          />
          <div className="row" style={{ marginTop: 16 }}>
            {index + 1 < queue.due.length ? (
              <button
                className="btn primary"
                disabled={!answered}
                onClick={() => {
                  setIndex(index + 1)
                  setAnswered(false)
                }}
              >
                Next →
              </button>
            ) : (
              <button className="btn primary" disabled={!answered} onClick={load}>
                Finish round
              </button>
            )}
            <button
              className="btn link"
              onClick={() => {
                setIndex((index + 1) % queue.due.length)
                setAnswered(false)
              }}
              disabled={queue.due.length < 2}
            >
              Skip for now
            </button>
          </div>
        </section>
      ) : (
        <section>
          <p className="notice ok">
            {queue.nextDueAt
              ? `All caught up. The next review comes up ${relativeTime(queue.nextDueAt)}.`
              : 'Nothing to review yet. Answer the questions in a lesson and they will come back here when they are due.'}
          </p>
          {queue.nextDueAt && (
            <button className="btn small" style={{ marginTop: 12 }} onClick={load}>
              Check again
            </button>
          )}
        </section>
      )}
    </>
  )
}
