import { useState } from 'react'
import type { AcceptResult, ProposalGroup, ProposalView } from '../../../shared/api'
import type { ProposalKind } from '../../../shared/domain'
import { api, useAction, useApi } from '../api'
import { OptimiseButton } from '../components/OptimiseButton'
import { formatDateTime } from '../components/status'

const KIND_LABELS: Record<ProposalKind, string> = {
  create_area: 'New area',
  update_area: 'Area',
  create_topic: 'New topic',
  update_topic: 'Edit topic',
  move_topic: 'Move',
  merge_topics: 'Merge',
  archive_topic: 'Archive',
  create_link: 'Link',
  remove_link: 'Unlink',
  lesson_patch: 'Lesson edit',
}

const TASK_LABELS: Record<string, string> = { capture: 'Capture', organise: 'Organise', lesson_patch: 'Co-author', optimise: 'Optimise' }

export function ReviewPage({ aiAvailable }: { aiAvailable: boolean }) {
  const { data, error } = useApi<{ pending: ProposalGroup[]; recent: ProposalView[] }>('/proposals')
  const organise = useAction()
  const [showRecent, setShowRecent] = useState(false)
  const total = data?.pending.reduce((n, g) => n + g.proposals.length, 0) ?? 0

  return (
    <>
      <span className="eyebrow">AI proposes, you decide</span>
      <h1>Suggestions to review</h1>
      <p className="lede">
        Nothing changes on your map until you accept it. Suggestions that depend on another one (a topic in a new area)
        are applied in the right order when you accept a whole run.
      </p>
      <div className="row" style={{ margin: '20px 0 32px' }}>
        <button
          className="btn"
          disabled={!aiAvailable || organise.busy}
          onClick={() => organise.run(() => api.post('/organise'))}
        >
          {organise.busy ? <span className="spinner" /> : '✦'} Organise my map
        </button>
        {organise.busy && <span className="muted small">Claude is looking across your whole map. This can take up to a minute.</span>}
      </div>
      <OptimiseButton aiAvailable={aiAvailable} />
      {organise.error && <p className="error">{organise.error}</p>}
      {error && <p className="error">{error}</p>}
      {data && total === 0 && <p className="empty">Nothing waiting. Capture some ideas on the home page, or run Organise.</p>}
      {data?.pending.map((group) => <RunGroup key={group.ai_run_id ?? 'manual'} group={group} />)}

      {data && data.recent.length > 0 && (
        <section>
          <div className="section-head">
            <h2>Recently decided</h2>
            <button className="btn link" onClick={() => setShowRecent(!showRecent)}>
              {showRecent ? 'Hide' : `Show ${data.recent.length}`}
            </button>
          </div>
          {showRecent && (
            <ul className="items decided">
              {data.recent.map((p) => (
                <li key={p.id}>
                  <span className={`tag ${p.status}`}>{p.status}</span>
                  <span>
                    {p.description}
                    {p.decision_note && <span className="muted"> · {p.decision_note}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  )
}

function RunGroup({ group }: { group: ProposalGroup }) {
  const { busy, error, run } = useAction()
  const [notes, setNotes] = useState<AcceptResult[]>([])
  const acceptAll = async () => {
    const ids = group.proposals.map((p) => p.id)
    const results = await run(() =>
      group.ai_run_id ? api.post<AcceptResult[]>(`/runs/${group.ai_run_id}/accept`) : api.post<AcceptResult[]>('/proposals/accept', { ids }),
    )
    if (results) setNotes(results.filter((r) => r.status !== 'accepted'))
  }
  const titleOf = (id: string) => group.proposals.find((p) => p.id === id)?.description ?? 'a suggestion'

  return (
    <div className="run">
      <div className="run-head">
        <span>
          <b>{group.task ? (TASK_LABELS[group.task] ?? group.task) : 'Suggestions'}</b>
          <span className="muted small">
            {' '}
            · {formatDateTime(group.created_at)} · {group.proposals.length} waiting
          </span>
        </span>
        <button className="btn primary small" disabled={busy} onClick={acceptAll}>
          Accept all
        </button>
      </div>
      {group.observations.length > 0 && (
        <ul className="observations run-observations">
          {group.observations.map((o, i) => (
            <li key={i}>{o}</li>
          ))}
        </ul>
      )}
      {group.proposals.map((p) => (
        <ProposalRow key={p.id} proposal={p} dependsOn={p.depends_on_id ? titleOf(p.depends_on_id) : null} />
      ))}
      {(error || notes.length > 0) && (
        <div style={{ padding: '0 18px 14px' }}>
          {error && <p className="error">{error}</p>}
          {notes.map((n) => (
            <p key={n.id} className="error">
              {n.decision_note}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

function ProposalRow({ proposal: p, dependsOn }: { proposal: ProposalView; dependsOn: string | null }) {
  const { busy, error, run } = useAction()
  return (
    <div className="proposal">
      <span className="kind">{KIND_LABELS[p.kind]}</span>
      <div className="what">
        <b>{p.description}</b>
        {p.detail && <p>{p.detail}</p>}
        {p.lesson_id && (
          <p>
            <a href={`#/lessons/${p.lesson_id}`}>Open the lesson</a> to see the diff.
          </p>
        )}
        {p.rationale && <p className="why">{p.rationale}</p>}
        {dependsOn && <p className="small">Applied after: {dependsOn}</p>}
        {error && <p className="error">{error}</p>}
      </div>
      <div className="actions">
        <button className="btn small primary" disabled={busy} onClick={() => run(() => api.post(`/proposals/${p.id}/accept`))}>
          Accept
        </button>
        <button className="btn small" disabled={busy} onClick={() => run(() => api.post(`/proposals/${p.id}/reject`))}>
          Reject
        </button>
      </div>
    </div>
  )
}
