import { useEffect, useState, type FormEvent } from 'react'
import { LESSON_LEVEL_LABELS, RESOURCE_KINDS, STATUS_LABELS, type ResourceKind, type TopicStatus } from '../../../shared/domain'
import type {
  GoalView,
  HomeData,
  LinkView,
  TopicDetail,
  TopicEventView,
  TopicListItem,
} from '../../../shared/api'
import { api, useAction, useApi } from '../api'
import { areaHref, lessonHref, topicHref } from '../router'
import { BuildLessonDialog } from './BuildLessonDialog'
import { STATUS_ORDER, formatDate, masteryText, percent } from './status'

export function TopicPanel({ topicId, onClose }: { topicId: string; onClose: () => void }) {
  const { data: topic, error } = useApi<TopicDetail>(`/topics/${topicId}`)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      <div className="panel-backdrop" onClick={onClose} />
      <aside className="panel" aria-label="Topic details">
        <div className="panel-head">
          <span className="eyebrow">
            {topic ? (topic.area?.name ?? 'Inbox') : 'Topic'}
            {topic?.parent && ` › ${topic.parent.title}`}
          </span>
          <button className="icon-btn close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        {topic && (
          <a className="btn small" href={topicHref(topic.id)} style={{ marginBottom: 14 }}>
            Open topic page →
          </a>
        )}
        {topic && <TopicBody key={topic.id} topic={topic} />}
      </aside>
    </>
  )
}

function TopicBody({ topic }: { topic: TopicDetail }) {
  const archived = Boolean(topic.archived_at)
  return (
    <>
      <Details topic={topic} />
      {archived ? (
        <Archived topic={topic} />
      ) : (
        <>
          <Status topic={topic} />
          <Lessons topic={topic} />
          <Links topic={topic} />
          <Goals topic={topic} />
          <Resources topic={topic} />
          <Manage topic={topic} />
        </>
      )}
      <History events={topic.events} />
    </>
  )
}

function Details({ topic }: { topic: TopicDetail }) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ title: topic.title, summary: topic.summary ?? '', why_i_care: topic.why_i_care ?? '' })
  const { busy, error, run } = useAction()

  if (!editing) {
    return (
      <div>
        <h2>{topic.title}</h2>
        {topic.summary ? <p className="text">{topic.summary}</p> : <p className="text muted">No summary yet.</p>}
        {topic.why_i_care && (
          <p className="text">
            <b>Why I care: </b>
            {topic.why_i_care}
          </p>
        )}
        {!topic.archived_at && (
          <button className="btn link" onClick={() => setEditing(true)}>
            Edit details
          </button>
        )}
      </div>
    )
  }
  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (await run(() => api.patch(`/topics/${topic.id}`, form))) setEditing(false)
  }
  return (
    <form className="stack" onSubmit={save}>
      <label className="field">
        <span>Title</span>
        <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      </label>
      <label className="field">
        <span>Summary</span>
        <textarea rows={3} value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} />
      </label>
      <label className="field">
        <span>Why I care</span>
        <textarea rows={2} value={form.why_i_care} onChange={(e) => setForm({ ...form, why_i_care: e.target.value })} />
      </label>
      <div className="row">
        <button className="btn primary" disabled={busy || !form.title.trim()}>
          Save
        </button>
        <button type="button" className="btn" onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </form>
  )
}

export function Status({ topic }: { topic: TopicDetail }) {
  const [note, setNote] = useState(topic.status.overrideNote ?? '')
  const { busy, error, run } = useAction()
  const set = (status: TopicStatus, withNote = note) =>
    run(() => api.post(`/topics/${topic.id}/status`, { status, note: withNote || null }))

  return (
    <section>
      <h3>Status</h3>
      <div className="segmented" role="group" aria-label="Status">
        {STATUS_ORDER.map((s) => (
          <button
            key={s}
            className={`${s} ${topic.status.effective === s ? 'on' : ''}`}
            disabled={busy}
            onClick={() => set(s, s === topic.status.derived ? '' : note)}
          >
            {s === 'solid' && topic.status.derived !== 'solid' ? 'Solid (self-assessed)' : STATUS_LABELS[s]}
          </button>
        ))}
      </div>
      <p className="measure">{masteryText(topic.status)}</p>
      {topic.status.override && (
        <div className="row" style={{ marginTop: 8 }}>
          <input
            className="grow"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why? (optional note)"
          />
          <button
            className="btn small"
            disabled={busy || note === (topic.status.overrideNote ?? '')}
            onClick={() => set(topic.status.override!)}
          >
            Save note
          </button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  )
}

export const ORIGIN_LABELS = { ai: 'by Claude', user: 'yours', imported_article: 'imported article' } as const

export function Lessons({ topic }: { topic: TopicDetail }) {
  const { data: home } = useApi<HomeData>('/home')
  const [building, setBuilding] = useState(false)
  const ai = home?.aiAvailable ?? false
  const m = topic.measurement
  return (
    <section>
      <h3>Lessons</h3>
      {topic.lessons.length === 0 && <p className="small muted">No lesson yet. Build one to learn and get tested.</p>}
      <ul className="items">
        {topic.lessons.map((l) => (
          <li key={l.id}>
            <span className="grow">
              <a href={lessonHref(l.id)}>{l.title}</a>
              <div className="small muted">
                v{l.version_no} · {l.level ? `${LESSON_LEVEL_LABELS[l.level]} · ` : ''}
                {ORIGIN_LABELS[l.origin]} ·{' '}
                {l.questionCount ? `${l.questionCount} question${l.questionCount === 1 ? '' : 's'}` : 'no questions yet'}
              </div>
            </span>
          </li>
        ))}
      </ul>
      {m.mastery !== null && (
        <p className="measure">
          {topic.subtopics.length > 0 && 'Includes its sub-topics. '}
          {percent(m.coverage!)} of questions tested · recall {m.retention === null ? 'not measured' : percent(m.retention)}
          {m.reviewsDue > 0 && (
            <>
              {' · '}
              <a href="#/practice">
                {m.reviewsDue} review{m.reviewsDue === 1 ? '' : 's'} due
              </a>
            </>
          )}
        </p>
      )}
      <button
        className="btn small"
        style={{ marginTop: 10 }}
        disabled={!ai}
        onClick={() => setBuilding(true)}
        title={ai ? 'Plan a lesson with Claude, then build it' : 'Set ANTHROPIC_API_KEY to build lessons'}
      >
        ✦ Build lesson
      </button>
      {building && <BuildLessonDialog topic={topic} onClose={() => setBuilding(false)} />}
    </section>
  )
}

const LINK_CHOICES = {
  needs: { label: 'Needs first', type: 'prerequisite_of', thisIs: 'to' },
  unlocks: { label: 'Prerequisite of', type: 'prerequisite_of', thisIs: 'from' },
  related: { label: 'Related to', type: 'related_to', thisIs: 'from' },
  part_of: { label: 'Part of', type: 'part_of', thisIs: 'from' },
  contains: { label: 'Contains', type: 'part_of', thisIs: 'to' },
} as const

function linkLabel(link: LinkView): string {
  if (link.link_type === 'related_to') return 'Related to'
  if (link.link_type === 'prerequisite_of') return link.direction === 'out' ? 'Prerequisite of' : 'Needs first'
  return link.direction === 'out' ? 'Part of' : 'Contains'
}

export function Links({ topic }: { topic: TopicDetail }) {
  const { data: topics } = useApi<TopicListItem[]>('/topics')
  const [choice, setChoice] = useState<keyof typeof LINK_CHOICES>('needs')
  const [other, setOther] = useState('')
  const { busy, error, run } = useAction()
  const add = async (e: FormEvent) => {
    e.preventDefault()
    const c = LINK_CHOICES[choice]
    const [from, to] = c.thisIs === 'from' ? [topic.id, other] : [other, topic.id]
    if (await run(() => api.post('/links', { from_topic_id: from, to_topic_id: to, link_type: c.type }))) setOther('')
  }
  const remove = (id: string) => run(() => api.del(`/links/${id}`))
  const candidates = (topics ?? []).filter((t) => t.id !== topic.id)

  return (
    <section>
      <h3>Links</h3>
      {topic.links.length === 0 && <p className="small muted">No links yet. Organise can suggest prerequisites.</p>}
      <ul className="items">
        {topic.links.map((l) => (
          <li key={l.id}>
            <span className="kind">{linkLabel(l)}</span>
            <span className="grow">
              <a href={areaHref(l.other.area_id, l.other.id)}>{l.other.title}</a>
              {l.rationale && <span className="small muted"> · {l.rationale}</span>}
            </span>
            <button className="icon-btn" onClick={() => remove(l.id)} aria-label="Remove link" disabled={busy}>
              ×
            </button>
          </li>
        ))}
      </ul>
      <form className="row" onSubmit={add} style={{ marginTop: 10 }}>
        <select value={choice} onChange={(e) => setChoice(e.target.value as keyof typeof LINK_CHOICES)}>
          {Object.entries(LINK_CHOICES).map(([key, c]) => (
            <option key={key} value={key}>
              {c.label}
            </option>
          ))}
        </select>
        <select className="grow" value={other} onChange={(e) => setOther(e.target.value)}>
          <option value="">Choose a topic…</option>
          {candidates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
        <button className="btn small" disabled={busy || !other}>
          Link
        </button>
      </form>
      {error && <p className="error">{error}</p>}
    </section>
  )
}

export function Goals({ topic }: { topic: TopicDetail }) {
  const { data: goals } = useApi<GoalView[]>('/goals')
  const [goalId, setGoalId] = useState('')
  const { busy, error, run } = useAction()
  const linked = new Set(topic.goals.map((g) => g.id))
  const available = (goals ?? []).filter((g) => !linked.has(g.id) && g.status === 'active')
  const add = async (e: FormEvent) => {
    e.preventDefault()
    if (await run(() => api.post(`/topics/${topic.id}/goals`, { goal_id: goalId }))) setGoalId('')
  }
  return (
    <section>
      <h3>Goals</h3>
      <div className="chip-row">
        {topic.goals.length === 0 && <span className="small muted">Not linked to a goal.</span>}
        {topic.goals.map((g) => (
          <span key={g.id} className="chip">
            {g.title}
            <button onClick={() => run(() => api.del(`/topics/${topic.id}/goals/${g.id}`))} aria-label="Unlink goal">
              ×
            </button>
          </span>
        ))}
      </div>
      {available.length > 0 ? (
        <form className="row" onSubmit={add} style={{ marginTop: 10 }}>
          <select className="grow" value={goalId} onChange={(e) => setGoalId(e.target.value)}>
            <option value="">Link to a goal…</option>
            {available.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </select>
          <button className="btn small" disabled={busy || !goalId}>
            Link
          </button>
        </form>
      ) : (
        <p className="small muted" style={{ marginTop: 8 }}>
          <a href="#/goals">Create a goal</a> to link it here. Linked topics rank higher in Next up.
        </p>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  )
}

export function Resources({ topic }: { topic: TopicDetail }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<{ kind: ResourceKind; title: string; url: string; note: string }>({
    kind: 'link',
    title: '',
    url: '',
    note: '',
  })
  const { busy, error, run } = useAction()
  const add = async (e: FormEvent) => {
    e.preventDefault()
    const body = { kind: form.kind, title: form.title, url: form.url.trim() || null, note: form.note.trim() || null }
    if (await run(() => api.post(`/topics/${topic.id}/resources`, body))) {
      setForm({ kind: 'link', title: '', url: '', note: '' })
      setOpen(false)
    }
  }
  return (
    <section>
      <h3>Resources</h3>
      {topic.resources.length === 0 && !open && <p className="small muted">Nothing saved yet.</p>}
      <ul className="items">
        {topic.resources.map((r) => (
          <li key={r.id}>
            <span className="kind">{r.kind}</span>
            <span className="grow">
              {r.url ? (
                <a href={r.url} target="_blank" rel="noreferrer">
                  {r.title}
                </a>
              ) : (
                <b style={{ fontWeight: 500 }}>{r.title}</b>
              )}
              {r.note && <div className="small muted">{r.note}</div>}
            </span>
            <button className="icon-btn" onClick={() => run(() => api.del(`/resources/${r.id}`))} aria-label="Remove">
              ×
            </button>
          </li>
        ))}
      </ul>
      {open ? (
        <form className="stack subform" onSubmit={add}>
          <div className="row">
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as ResourceKind })}>
              {RESOURCE_KINDS.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
            <input className="grow" placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <input type="url" placeholder="https://… (optional)" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
          <textarea rows={2} placeholder="Note (optional)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          <div className="row">
            <button className="btn small primary" disabled={busy || !form.title.trim() || !(form.url.trim() || form.note.trim())}>
              Add resource
            </button>
            <button type="button" className="btn small" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button className="btn small" style={{ marginTop: 10 }} onClick={() => setOpen(true)}>
          + Add resource
        </button>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  )
}

function Manage({ topic }: { topic: TopicDetail }) {
  const { data: home } = useApi<HomeData>('/home')
  const { data: topics } = useApi<TopicListItem[]>('/topics')
  const [mergeId, setMergeId] = useState('')
  const { busy, error, run } = useAction()
  const move = (areaId: string) => run(() => api.patch(`/topics/${topic.id}`, { area_id: areaId || null }))
  const merge = async () => {
    const other = topics?.find((t) => t.id === mergeId)
    if (!other || !confirm(`Merge "${other.title}" into "${topic.title}"? Its links, goals, resources and lessons move here.`)) return
    if (await run(() => api.post(`/topics/${topic.id}/merge`, { merge_topic_id: mergeId }))) setMergeId('')
  }
  const archive = () => {
    if (confirm(`Archive "${topic.title}"? You can restore it later from its history.`)) {
      void run(() => api.post(`/topics/${topic.id}/archive`))
    }
  }
  return (
    <section>
      <h3>Organise</h3>
      <div className="stack">
        <label className="field">
          <span>Area</span>
          <select value={topic.area_id ?? ''} onChange={(e) => move(e.target.value)} disabled={busy}>
            <option value="">Inbox (no area)</option>
            {home?.areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <div className="field">
          <span>Merge a duplicate into this topic</span>
          <div className="row">
            <select className="grow" value={mergeId} onChange={(e) => setMergeId(e.target.value)}>
              <option value="">Choose the duplicate…</option>
              {topics
                ?.filter((t) => t.id !== topic.id)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
            </select>
            <button className="btn small" disabled={busy || !mergeId} onClick={merge}>
              Merge
            </button>
          </div>
        </div>
        <div>
          <button className="btn small danger" onClick={archive} disabled={busy}>
            Archive topic
          </button>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
    </section>
  )
}

function Archived({ topic }: { topic: TopicDetail }) {
  const { busy, error, run } = useAction()
  return (
    <section>
      <div className="notice">
        {topic.merged_into_id ? (
          <>
            Merged into <a href={areaHref(null, topic.merged_into_id)}>another topic</a> on {formatDate(topic.archived_at!)}.
          </>
        ) : (
          <>
            Archived on {formatDate(topic.archived_at!)}.{' '}
            <button className="btn small" disabled={busy} onClick={() => run(() => api.post(`/topics/${topic.id}/restore`))}>
              Restore
            </button>
          </>
        )}
      </div>
      {error && <p className="error">{error}</p>}
    </section>
  )
}

function describeEvent(e: TopicEventView): string {
  switch (e.event_type) {
    case 'created':
      return 'Created'
    case 'renamed':
      return `Renamed from "${e.from_value}" to "${e.to_value}"`
    case 'area_changed':
      return `Moved from ${e.from_value} to ${e.to_value}`
    case 'status_override_set':
      return `Status set to ${STATUS_LABELS[e.to_value as TopicStatus] ?? e.to_value}`
    case 'status_override_cleared':
      return 'Status override cleared'
    case 'status_override_resolved':
      return 'Override cleared: measurement caught up'
    case 'merged':
      return `"${e.from_value}" merged into "${e.to_value}"`
    case 'archived':
      return 'Archived'
    case 'restored':
      return 'Restored'
  }
}

export function History({ events }: { events: TopicEventView[] }) {
  return (
    <section>
      <h3>History</h3>
      <ul className="timeline">
        {events.map((e) => (
          <li key={e.id}>
            <time dateTime={e.created_at}>{formatDate(e.created_at)}</time>
            <span>
              {describeEvent(e)}
              {e.actor === 'proposal' && <span className="muted"> · accepted suggestion</span>}
              {e.actor === 'system' && <span className="muted"> · system</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
