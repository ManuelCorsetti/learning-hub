// A topic as a page: its sub-topics as a learning path, its lessons, and everything from the
// side panel (status, links, resources, goals, history) alongside.
import { useState, type FormEvent } from 'react'
import type { SubtopicItem, TopicDetail } from '../../../shared/api'
import { LESSON_LEVEL_LABELS } from '../../../shared/domain'
import { api, useAction, useApi } from '../api'
import { BuildLessonDialog } from '../components/BuildLessonDialog'
import { Breadcrumbs, topicCrumbs } from '../components/Breadcrumbs'
import { Goals, History, Links, ORIGIN_LABELS, Resources, Status } from '../components/TopicPanel'
import { StatusPill, percent } from '../components/status'
import { areaHref, lessonHref, topicHref } from '../router'

export function TopicPage({ topicId, aiAvailable }: { topicId: string; aiAvailable: boolean }) {
  const { data: topic, error } = useApi<TopicDetail>(`/topics/${topicId}`)
  if (error) return <p className="error">{error}</p>
  if (!topic) return <p className="muted">Loading…</p>
  return <Topic key={topic.id} topic={topic} aiAvailable={aiAvailable} />
}

function Topic({ topic, aiAvailable }: { topic: TopicDetail; aiAvailable: boolean }) {
  const [building, setBuilding] = useState(false)
  const m = topic.measurement
  const isParent = topic.subtopics.length > 0
  return (
    <div className="topic-page">
      <Breadcrumbs items={topicCrumbs(topic)} />
      <div className="article-heading">
        <div>
          <span className="eyebrow">{topic.parent ? `Sub-topic of ${topic.parent.title}` : 'Topic'}</span>
          <h1>{topic.title}</h1>
          {topic.summary && <p className="lede">{topic.summary}</p>}
          <div className="row" style={{ marginTop: 14 }}>
            <StatusPill status={topic.status} />
            <span className="summary-line">
              {m.mastery === null
                ? 'Not measured yet'
                : `Mastery ${percent(m.mastery)}${isParent ? ' across its sub-topics' : ''} · ${percent(m.coverage!)} tested`}
              {m.reviewsDue > 0 && (
                <>
                  {' · '}
                  <a href="#/practice">{m.reviewsDue} due</a>
                </>
              )}
            </span>
          </div>
        </div>
        {topic.archived_at && <span className="tag rejected">Archived</span>}
      </div>

      <div className="topic-layout">
        <div className="topic-main">
          {(isParent || !topic.parent) && <Path topic={topic} />}

          <section>
            <div className="section-head">
              <h2>Lessons</h2>
              <span>
                {topic.lessons.length
                  ? 'In the order they were built. New lessons build on these.'
                  : 'Plan a lesson with Claude: it uses your profile and what you already know.'}
              </span>
              <span className="spacer" />
              <button
                className="btn primary"
                disabled={!aiAvailable || Boolean(topic.archived_at)}
                onClick={() => setBuilding(true)}
                title={aiAvailable ? undefined : 'Set ANTHROPIC_API_KEY to build lessons'}
              >
                ✦ Build lesson
              </button>
            </div>
            {topic.lessons.length === 0 ? (
              <p className="empty">No lessons yet.</p>
            ) : (
              <div className="grid">
                {topic.lessons.map((l, i) => (
                  <a key={l.id} className="card lesson-card" href={lessonHref(l.id)}>
                    <span className="card-label">
                      Lesson {i + 1} · v{l.version_no}
                      {l.level && ` · ${LESSON_LEVEL_LABELS[l.level]}`}
                    </span>
                    <h3>{l.title}</h3>
                    {l.brief && <p>{l.brief}</p>}
                    <span className="small muted">
                      {ORIGIN_LABELS[l.origin]} ·{' '}
                      {l.questionCount ? `${l.questionCount} question${l.questionCount === 1 ? '' : 's'}` : 'no questions yet'}
                    </span>
                  </a>
                ))}
              </div>
            )}
          </section>
          {building && <BuildLessonDialog topic={topic} onClose={() => setBuilding(false)} />}
        </div>

        <aside className="topic-side">
          {topic.why_i_care && (
            <section>
              <h3>Why I care</h3>
              <p className="text">{topic.why_i_care}</p>
            </section>
          )}
          {!topic.archived_at && (
            <>
              <Status topic={topic} />
              <Resources topic={topic} />
              <Links topic={topic} />
              <Goals topic={topic} />
            </>
          )}
          <section>
            <a className="btn small" href={areaHref(topic.area?.id ?? null, topic.id)}>
              Edit, move or merge…
            </a>
          </section>
          <History events={topic.events} />
        </aside>
      </div>
    </div>
  )
}

function Path({ topic }: { topic: TopicDetail }) {
  return (
    <section>
      <div className="section-head">
        <h2>Learning path</h2>
        <span>
          {topic.subtopics.length
            ? 'Sub-topics in prerequisite order. Link sub-topics as prerequisites to change the order.'
            : 'Split a broad topic into sub-topics to learn it step by step.'}
        </span>
      </div>
      {topic.subtopics.length > 0 && (
        <ol className="path">
          {topic.subtopics.map((s, i) => (
            <PathItem key={s.id} item={s} index={i} />
          ))}
        </ol>
      )}
      {!topic.archived_at && <AddSubtopic topic={topic} />}
    </section>
  )
}

function PathItem({ item, index }: { item: SubtopicItem; index: number }) {
  return (
    <li className={`path-item ${item.next ? 'next' : ''} ${item.status.effective}`}>
      <span className="path-no">{String(index + 1).padStart(2, '0')}</span>
      <a href={topicHref(item.id)} className="grow">
        <b>{item.title}</b>
        {item.summary && <span className="small muted">{item.summary}</span>}
        {item.prereqs.length > 0 && <span className="small muted">Needs {item.prereqs.join(', ')} first</span>}
      </a>
      {item.next && <span className="pill">Next</span>}
      {item.status.mastery !== null && <span className="small muted mono">{percent(item.status.mastery)}</span>}
      <StatusPill status={item.status} />
    </li>
  )
}

function AddSubtopic({ topic }: { topic: TopicDetail }) {
  const [title, setTitle] = useState('')
  const { busy, error, run } = useAction()
  if (topic.parent) return null
  const add = async (e: FormEvent) => {
    e.preventDefault()
    const ok = await run(async () => {
      const created = await api.post<{ id: string }>('/topics', { title, area_id: topic.area?.id ?? null })
      return api.post('/links', { from_topic_id: created.id, to_topic_id: topic.id, link_type: 'part_of' })
    })
    if (ok) setTitle('')
  }
  return (
    <form className="add-topic" onSubmit={add} style={{ marginTop: 14 }}>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`Add a sub-topic of ${topic.title}`} />
      <button className="btn" disabled={busy || !title.trim()}>
        Add sub-topic
      </button>
      {error && <p className="error">{error}</p>}
    </form>
  )
}
