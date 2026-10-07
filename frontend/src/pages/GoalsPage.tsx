import { useState, type FormEvent } from 'react'
import type { GoalView } from '../../../shared/api'
import { GOAL_STATUSES, type GoalStatus } from '../../../shared/domain'
import { api, useAction, useApi } from '../api'
import { formatDate } from '../components/status'
import { areaHref } from '../router'

export function GoalsPage() {
  const { data, error } = useApi<GoalView[]>('/goals')
  return (
    <>
      <span className="eyebrow">What the learning is for</span>
      <h1>Goals</h1>
      <p className="lede">
        A goal is an outcome with an optional date, like an internal article or a project. Link topics to it from the
        topic panel. Topics serving an active goal rank higher in Next up.
      </p>
      <NewGoal />
      {error && <p className="error">{error}</p>}
      {data && data.length === 0 && <p className="empty">No goals yet.</p>}
      <div className="grid" style={{ marginTop: 28 }}>
        {data?.map((g) => <GoalCard key={g.id} goal={g} />)}
      </div>
    </>
  )
}

function NewGoal() {
  const [form, setForm] = useState({ title: '', target_date: '', description: '' })
  const { busy, error, run } = useAction()
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const body = { title: form.title, target_date: form.target_date || null, description: form.description || null }
    if (await run(() => api.post('/goals', body))) setForm({ title: '', target_date: '', description: '' })
  }
  return (
    <form className="stack" onSubmit={submit} style={{ marginTop: 24, maxWidth: 720 }}>
      <div className="row">
        <input
          className="grow"
          placeholder="e.g. Internal article on AI and data engineering"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
        />
        <input
          type="date"
          aria-label="Target date"
          value={form.target_date}
          onChange={(e) => setForm({ ...form, target_date: e.target.value })}
        />
        <button className="btn primary" disabled={busy || !form.title.trim()}>
          Add goal
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </form>
  )
}

function GoalCard({ goal }: { goal: GoalView }) {
  const { busy, error, run } = useAction()
  return (
    <div className={`goal ${goal.status === 'active' ? '' : 'dim'}`}>
      <h3>{goal.title}</h3>
      <div className="meta">
        <span>{goal.target_date ? `by ${formatDate(goal.target_date)}` : 'no date'}</span>
        <select
          value={goal.status}
          disabled={busy}
          onChange={(e) => run(() => api.patch(`/goals/${goal.id}`, { status: e.target.value as GoalStatus }))}
        >
          {GOAL_STATUSES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      {goal.description && <p className="muted small">{goal.description}</p>}
      <div className="chip-row">
        {goal.topics.length === 0 && <span className="small muted">No topics linked yet.</span>}
        {goal.topics.map((t) => (
          <a key={t.id} className="chip" href={areaHref(null, t.id)}>
            {t.title}
          </a>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  )
}
