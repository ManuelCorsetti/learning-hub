import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { AreaSummary, HomeData, NextUpItem } from '../../../shared/api'
import { api, useAction, useApi } from '../api'
import { StatusBar, legendText } from '../components/status'
import { areaHref, navigate, topicHref } from '../router'

interface CaptureResult {
  created: number
  newAreas: number
  skipped: { title: string; reason: string }[]
}

export function HomePage({ home, error }: { home: HomeData | null; error: string | null }) {
  if (error) return <p className="error">Could not reach the API: {error}. Is `npm run dev` running?</p>
  if (!home) return <p className="muted">Loading…</p>
  const pendingText = home.pendingProposals
    ? ` · ${home.pendingProposals} suggestion${home.pendingProposals === 1 ? '' : 's'} to review`
    : ''
  return (
    <>
      <section>
        <span className="eyebrow">Your learning map</span>
        <h1>
          What do you want to get <em>good</em> at?
        </h1>
        <span className="summary-line">
          {home.areas.length} area{home.areas.length === 1 ? '' : 's'} · {home.topicCount} topic
          {home.topicCount === 1 ? '' : 's'}
          {pendingText}
        </span>
        <Capture aiAvailable={home.aiAvailable} />
      </section>
      <NextUp aiAvailable={home.aiAvailable} />
      <Areas home={home} />
    </>
  )
}

function Capture({ aiAvailable }: { aiAvailable: boolean }) {
  const [text, setText] = useState('')
  const [result, setResult] = useState<CaptureResult | null>(null)
  const { busy, error, run } = useAction()

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setResult(null)
    const res = await run(() => api.post<CaptureResult>('/capture', { text }))
    if (res) {
      setResult(res)
      setText('')
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="capture">
        <textarea
          aria-label="Things you want to learn"
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={busy}
          placeholder={
            aiAvailable
              ? 'Dump it all here, messy is fine. Rust or Go, typer for CLI stuff, how Pydantic validators work…'
              : 'Capture needs Claude. Set ANTHROPIC_API_KEY and restart `npm run dev`. You can still add topics by hand on an area page.'
          }
        />
        <button className="btn primary" disabled={busy || !aiAvailable || text.trim().length < 3}>
          Capture
        </button>
      </div>
      {busy && (
        <div className="working">
          <span className="spinner" /> Claude is reading your notes and checking them against your map. This can take
          up to a minute.
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {result && (
        <div className="notice ok" style={{ marginTop: 14 }}>
          {result.created + result.newAreas === 0 ? (
            'Nothing new to add.'
          ) : (
            <>
              {result.created} topic suggestion{result.created === 1 ? '' : 's'}
              {result.newAreas > 0 && ` and ${result.newAreas} new area${result.newAreas === 1 ? '' : 's'}`} ready.{' '}
              <a href="#/review">Review them</a>
            </>
          )}
          {result.skipped.length > 0 && (
            <div className="small muted" style={{ marginTop: 6 }}>
              Skipped: {result.skipped.map((s) => `${s.title} (${s.reason})`).join('; ')}
            </div>
          )}
        </div>
      )}
    </form>
  )
}

function NextUp({ aiAvailable }: { aiAvailable: boolean }) {
  const { data } = useApi<NextUpItem[]>('/next-up')
  const asked = useRef(false)
  const top = data?.slice(0, 3) ?? []

  // Ask Claude for the "why" lines once per visit when some are missing; fall back to the rule-based text.
  useEffect(() => {
    if (!aiAvailable || asked.current || !top.length || top.every((i) => i.why)) return
    asked.current = true
    api.post('/next-up/explain').catch(() => {})
  }, [aiAvailable, top])

  return (
    <section>
      <div className="section-head">
        <h2>Next up</h2>
        <span>Ranked by what each topic unlocks, your goals and what you have started</span>
      </div>
      {data && !top.length && <p className="empty">Add a few topics and Next up will suggest where to start.</p>}
      <div className="grid">
        {top.map((item) => (
          <a key={item.topic_id} className="card next-card" href={topicHref(item.topic_id)}>
            <span className="card-label">{item.areaName ?? 'Inbox'}</span>
            <span className="score" title="Next up score">
              {item.score}
            </span>
            <h3>{item.title}</h3>
            <p>{item.why ?? item.fallbackWhy}</p>
          </a>
        ))}
      </div>
    </section>
  )
}

function Areas({ home }: { home: HomeData }) {
  const organise = useAction()
  const [organised, setOrganised] = useState<string | null>(null)

  const runOrganise = async () => {
    setOrganised(null)
    const res = await organise.run(() => api.post<{ created: number }>('/organise'))
    if (res) {
      if (res.created) navigate('#/review')
      else setOrganised('No changes suggested. Your map looks organised.')
    }
  }

  return (
    <section>
      <div className="section-head">
        <h2>Your areas</h2>
        <span>Open one to drill down</span>
        <span className="spacer" />
        <button
          className="btn"
          onClick={runOrganise}
          disabled={!home.aiAvailable || organise.busy || home.topicCount < 2}
          title="Claude suggests areas, moves, merges and links. You review each one."
        >
          {organise.busy ? <span className="spinner" /> : '✦'} Organise
        </button>
      </div>
      {organise.busy && <p className="working">Claude is looking across your whole map. This can take up to a minute.</p>}
      {organise.error && <p className="error">{organise.error}</p>}
      {organised && <p className="notice ok">{organised}</p>}
      <div className="grid">
        {home.areas.map((area, i) => (
          <AreaCard key={area.id} area={area} index={i} />
        ))}
        {home.inboxCount > 0 && (
          <a className="card area-card inbox" href={areaHref(null)}>
            <div className="top">
              <span>In</span>
              <span>
                {home.inboxCount} topic{home.inboxCount === 1 ? '' : 's'}
              </span>
            </div>
            <h3>Inbox</h3>
            <p>Topics without an area yet. Organise can suggest where they belong.</p>
          </a>
        )}
        <NewAreaCard />
      </div>
    </section>
  )
}

function AreaCard({ area, index }: { area: AreaSummary; index: number }) {
  const more = area.topicCount - area.chips.length
  return (
    <a className="card area-card" href={areaHref(area.id)}>
      <div className="top">
        <span>{String(index + 1).padStart(2, '0')}</span>
        <span>
          {area.topicCount} topic{area.topicCount === 1 ? '' : 's'}
        </span>
      </div>
      <div className="stack" style={{ gap: 6 }}>
        <h3>{area.name}</h3>
        {area.summary && <p>{area.summary}</p>}
      </div>
      <div className="stack" style={{ gap: 8 }}>
        <StatusBar counts={area.counts} />
        <span className="legend">{legendText(area.counts)}</span>
      </div>
      {area.chips.length > 0 && (
        <span className="chips">
          {area.chips.join(' · ')}
          {more > 0 && ` +${more}`}
        </span>
      )}
      {area.pendingProposals > 0 && (
        <span className="pill">
          {area.pendingProposals} suggestion{area.pendingProposals === 1 ? '' : 's'} to review
        </span>
      )}
    </a>
  )
}

function NewAreaCard() {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [summary, setSummary] = useState('')
  const { busy, error, run } = useAction()

  if (!open) {
    return (
      <button className="card new-card" onClick={() => setOpen(true)}>
        + New area
      </button>
    )
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const created = await run(() => api.post<{ id: string }>('/areas', { name, summary }))
    if (created) {
      setOpen(false)
      setName('')
      setSummary('')
    }
  }
  return (
    <div className="card new-card">
      <form className="stack" onSubmit={submit}>
        <label className="field">
          <span>Area name</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Python" />
        </label>
        <label className="field">
          <span>Summary</span>
          <textarea rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} />
        </label>
        <div className="row">
          <button className="btn primary" disabled={busy || !name.trim()}>
            Create area
          </button>
          <button type="button" className="btn" onClick={() => setOpen(false)}>
            Cancel
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </form>
    </div>
  )
}
