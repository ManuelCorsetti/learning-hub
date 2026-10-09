// Build lesson: pick a level, write a brief, plan it with Claude, then build.
// Claude may ask a few questions; you can answer or build anyway at any point.
import { useEffect, useState, type FormEvent } from 'react'
import type { LessonRequestView, LessonView, SettingsView } from '../../../shared/api'
import { LESSON_LEVEL_LABELS, LESSON_LEVELS, type LessonLevel } from '../../../shared/domain'
import { api, useAction, useApi } from '../api'
import { lessonHref, navigate } from '../router'

export function BuildLessonDialog({ topic, onClose }: { topic: { id: string; title: string }; onClose: () => void }) {
  const [request, setRequest] = useState<LessonRequestView | null>(null)
  const plan = useAction()
  const build = useAction()
  const busy = plan.busy || build.busy

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const start = async (level: LessonLevel | null, brief: string, thenBuild: boolean) => {
    const created = await plan.run(() => api.post<LessonRequestView>(`/topics/${topic.id}/lesson-requests`, { level, brief }))
    if (!created) return
    setRequest(created)
    if (thenBuild) await buildNow(created.id)
  }
  const reply = async (message: string) => {
    if (!request) return false
    const next = await plan.run(() => api.post<LessonRequestView>(`/lesson-requests/${request.id}/reply`, { message }))
    if (next) setRequest(next)
    return Boolean(next)
  }
  const buildNow = async (id = request?.id) => {
    if (!id) return
    const lesson = await build.run(() => api.post<LessonView>(`/lesson-requests/${id}/build`))
    if (lesson) {
      onClose()
      navigate(lessonHref(lesson.id))
    }
  }

  return (
    <>
      <div className="panel-backdrop" onClick={() => !busy && onClose()} />
      <div className="dialog" role="dialog" aria-label="Build a lesson">
        <div className="panel-head">
          <div>
            <span className="eyebrow">Build a lesson</span>
            <h2>{topic.title}</h2>
          </div>
          <button className="icon-btn close" onClick={onClose} disabled={busy} aria-label="Close">
            ×
          </button>
        </div>
        {request ? (
          <Conversation request={request} busy={plan.busy} onReply={reply} />
        ) : (
          <Brief busy={busy} onStart={start} />
        )}
        {plan.busy && (
          <p className="working">
            <span className="spinner" /> Claude is planning the lesson against your profile and what you have learned so far.
          </p>
        )}
        {build.busy && (
          <p className="working">
            <span className="spinner" /> Claude is writing the lesson and its questions. This can take a couple of minutes.
          </p>
        )}
        {plan.error && <p className="error">{plan.error}</p>}
        {build.error && <p className="error">{build.error}</p>}
        {request && (
          <div className="row dialog-actions">
            <button className="btn primary" disabled={busy} onClick={() => buildNow()}>
              {request.messages.at(-1)?.role === 'assistant' && lastReady(request) ? 'Build this lesson' : 'Build anyway'}
            </button>
            <span className="small muted">You can build at any point; answering just makes the lesson fit better.</span>
          </div>
        )}
      </div>
    </>
  )
}

const lastReady = (r: LessonRequestView) => {
  const last = r.messages.at(-1)
  return last?.role === 'assistant' && last.ready
}

function Brief({ busy, onStart }: { busy: boolean; onStart: (level: LessonLevel | null, brief: string, thenBuild: boolean) => void }) {
  const { data: settings } = useApi<SettingsView>('/settings')
  const [level, setLevel] = useState<LessonLevel | null>(null)
  const [brief, setBrief] = useState('')
  const profileEmpty = settings && !Object.values(settings.profile).some((v) => v.trim())
  const submit = (e: FormEvent) => {
    e.preventDefault()
    onStart(level, brief, false)
  }
  return (
    <form className="stack" onSubmit={submit}>
      <div className="field">
        <span>Level (guidance)</span>
        <div className="segmented" role="group" aria-label="Level">
          <button type="button" className={`learning ${level === null ? 'on' : ''}`} onClick={() => setLevel(null)}>
            Claude decides
          </button>
          {LESSON_LEVELS.map((l) => (
            <button key={l} type="button" className={`learning ${level === l ? 'on' : ''}`} onClick={() => setLevel(l)}>
              {LESSON_LEVEL_LABELS[l]}
            </button>
          ))}
        </div>
      </div>
      <label className="field">
        <span>What do you want from this lesson?</span>
        <textarea
          rows={4}
          autoFocus
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder="e.g. How CDC works with Datastream into BigQuery, with examples from our marketing impressions table. I know the basics of logical replication."
        />
      </label>
      {profileEmpty && (
        <p className="notice">
          You have no profile yet. <a href="#/settings">Add one in Settings</a> so lessons use your stack and use case.
        </p>
      )}
      <div className="row">
        <button className="btn primary" disabled={busy}>
          Plan with Claude
        </button>
        <button type="button" className="btn" disabled={busy} onClick={() => onStart(level, brief, true)}>
          Skip planning and build
        </button>
      </div>
    </form>
  )
}

function Conversation({
  request,
  busy,
  onReply,
}: {
  request: LessonRequestView
  busy: boolean
  onReply: (message: string) => Promise<boolean>
}) {
  const [message, setMessage] = useState('')
  const send = async (e: FormEvent) => {
    e.preventDefault()
    if (await onReply(message)) setMessage('')
  }
  const last = request.messages.at(-1)
  return (
    <div className="stack">
      {(request.level || request.brief) && (
        <div className="chat-msg user">
          {request.level && <b>{LESSON_LEVEL_LABELS[request.level]}. </b>}
          {request.brief}
        </div>
      )}
      {request.messages.map((m, i) =>
        m.role === 'user' ? (
          <div key={i} className="chat-msg user">
            {m.content}
          </div>
        ) : (
          <div key={i} className="chat-msg assistant">
            <p>{m.reply}</p>
            {m.questions.length > 0 && (
              <ol>
                {m.questions.map((q, j) => (
                  <li key={j}>{q}</li>
                ))}
              </ol>
            )}
          </div>
        ),
      )}
      {request.plan && (
        <div className="plan-card">
          <span className="card-label">Plan</span>
          <b>{request.plan.title}</b>
          <p>{request.plan.summary}</p>
          <ol>
            {request.plan.outline.map((o, i) => (
              <li key={i}>{o}</li>
            ))}
          </ol>
          {request.plan.examples && <p className="small muted">Examples: {request.plan.examples}</p>}
        </div>
      )}
      {request.messages.length === 0 && !busy && (
        <p className="small muted">AI is off, so there is no planning. Set ANTHROPIC_API_KEY to plan and build lessons.</p>
      )}
      {last?.role === 'assistant' && (
        <form className="stack" onSubmit={send}>
          <textarea
            rows={3}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            disabled={busy}
            placeholder={last.ready ? 'Anything to change? (optional)' : 'Answer the questions, or say "just build it"'}
          />
          <div>
            <button className="btn small" disabled={busy || !message.trim()}>
              Send
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
