import { useState, type FormEvent } from 'react'
import type { AreaDetail, TopicListItem } from '../../../shared/api'
import { api, useAction, useApi } from '../api'
import { Breadcrumbs } from '../components/Breadcrumbs'
import { StatusBar, StatusPill, legendText } from '../components/status'
import { TopicGraph } from '../components/TopicGraph'
import { TopicPanel } from '../components/TopicPanel'
import { areaHref, navigate, topicHref, type AreaView } from '../router'

export function AreaPage({ areaId, topicId, view }: { areaId: string; topicId: string | null; view: AreaView }) {
  const { data, error } = useApi<AreaDetail>(`/areas/${areaId}`)
  const [editing, setEditing] = useState(false)
  const ownArea = areaId === 'inbox' ? null : areaId
  const openTopic = (id: string | null) => navigate(areaHref(ownArea, id, view))
  const setView = (v: AreaView) => navigate(areaHref(ownArea, topicId, v))

  if (error) {
    return (
      <>
        <a className="back" href="#/">
          ← All areas
        </a>
        <p className="error">{error}</p>
      </>
    )
  }
  if (!data) return <p className="muted">Loading…</p>

  const counts = { backlog: 0, learning: 0, solid: 0 }
  for (const t of data.topics) counts[t.status.effective]++

  return (
    <>
      <Breadcrumbs items={[{ label: 'Map', href: '#/' }, { label: data.area?.name ?? 'Inbox' }]} />
      <div className="area-head">
        <div style={{ flex: 1 }}>
          <span className="eyebrow">{data.area ? `Area ${String(data.area.position).padStart(2, '0')}` : 'Unsorted'}</span>
          {editing && data.area ? (
            <EditArea area={data.area} onDone={() => setEditing(false)} />
          ) : (
            <>
              <h1>{data.area?.name ?? 'Inbox'}</h1>
              <p className="lede">
                {data.area?.summary ?? (data.area ? '' : 'Topics without an area. Move them from the topic panel, or run Organise.')}
              </p>
            </>
          )}
          <div className="stack" style={{ maxWidth: 420, gap: 8, marginTop: 18 }}>
            <StatusBar counts={counts} />
            <span className="legend">{legendText(counts)}</span>
          </div>
        </div>
        {data.area && !editing && (
          <button className="btn" onClick={() => setEditing(true)}>
            Edit area
          </button>
        )}
      </div>

      <div className="toolbar">
        <div className="tabs" role="tablist">
          <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>
            List
          </button>
          <button className={view === 'graph' ? 'active' : ''} onClick={() => setView('graph')}>
            Graph
          </button>
        </div>
        <AddTopic areaId={data.area?.id ?? null} onAdded={openTopic} />
      </div>

      {view === 'list' ? (
        <div className="topic-list">
          {data.topics.length === 0 && <p className="empty">No topics here yet. Add one above, or use Capture on the home page.</p>}
          {grouped(data.topics).map(({ topic: t, depth, childCount }) => (
            <a key={t.id} className={`topic-row ${depth ? 'sub' : ''} ${t.id === topicId ? 'selected' : ''}`} href={topicHref(t.id)}>
              <b>
                {t.title}
                {childCount > 0 && (
                  <span className="small muted">
                    {' '}
                    · {childCount} sub-topic{childCount === 1 ? '' : 's'}
                  </span>
                )}
              </b>
              <StatusPill status={t.status} />
              {t.summary && <p>{t.summary}</p>}
            </a>
          ))}
        </div>
      ) : (
        <TopicGraph areaId={areaId} onOpen={openTopic} />
      )}

      {topicId && <TopicPanel topicId={topicId} onClose={() => openTopic(null)} />}
    </>
  )
}

/** Top-level topics in title order, each followed by its sub-topics. */
function grouped(topics: TopicListItem[]): { topic: TopicListItem; depth: number; childCount: number }[] {
  const ids = new Set(topics.map((t) => t.id))
  const childrenOf = (id: string) => topics.filter((t) => t.parent_id === id)
  return topics
    .filter((t) => !t.parent_id || !ids.has(t.parent_id))
    .flatMap((t) => [
      { topic: t, depth: 0, childCount: childrenOf(t.id).length },
      ...childrenOf(t.id).map((c) => ({ topic: c, depth: 1, childCount: 0 })),
    ])
}

function AddTopic({ areaId, onAdded }: { areaId: string | null; onAdded: (id: string) => void }) {
  const [title, setTitle] = useState('')
  const { busy, error, run } = useAction()
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const created = await run(() => api.post<{ id: string }>('/topics', { title, area_id: areaId }))
    if (created) {
      setTitle('')
      onAdded(created.id)
    }
  }
  return (
    <form className="add-topic" onSubmit={submit}>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a topic by hand" />
      <button className="btn primary" disabled={busy || !title.trim()}>
        Add topic
      </button>
      {error && <p className="error">{error}</p>}
    </form>
  )
}

function EditArea({ area, onDone }: { area: NonNullable<AreaDetail['area']>; onDone: () => void }) {
  const [name, setName] = useState(area.name)
  const [summary, setSummary] = useState(area.summary ?? '')
  const { busy, error, run } = useAction()
  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (await run(() => api.patch(`/areas/${area.id}`, { name, summary }))) onDone()
  }
  const archive = async () => {
    if (!confirm(`Archive "${area.name}"? It must have no topics left.`)) return
    if (await run(() => api.post(`/areas/${area.id}/archive`))) navigate('#/')
  }
  return (
    <form className="stack" onSubmit={save} style={{ maxWidth: 620 }}>
      <label className="field">
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span>Summary</span>
        <textarea rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} />
      </label>
      <div className="row">
        <button className="btn primary" disabled={busy || !name.trim()}>
          Save
        </button>
        <button type="button" className="btn" onClick={onDone}>
          Cancel
        </button>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn danger" onClick={archive} disabled={busy}>
          Archive area
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </form>
  )
}
