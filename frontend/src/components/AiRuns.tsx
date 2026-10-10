// Recent Claude calls, from ai_runs: what was asked, what came back, and why a call failed.
import { useState } from 'react'
import type { AiRunDetail, AiRunSummary } from '../../../shared/api'
import { useApi } from '../api'
import { modelLabel } from '../pages/SettingsPage'
import { formatDateTime } from './status'

export function AiRuns() {
  const { data: runs, error, reload } = useApi<AiRunSummary[]>('/ai-runs')
  const [open, setOpen] = useState<string | null>(null)
  return (
    <section>
      <div className="section-head">
        <h2>Recent Claude calls</h2>
        <span>Every call is logged: the request, each attempt's raw output and any validation errors.</span>
        <span className="spacer" />
        <button className="btn small" onClick={() => void reload()}>
          Refresh
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {runs && runs.length === 0 && <p className="empty">No calls yet.</p>}
      <ul className="ai-runs">
        {runs?.map((r) => (
          <li key={r.id} className={r.outcome}>
            <button className="ai-run-row" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
              <time dateTime={r.created_at}>{formatDateTime(r.created_at)}</time>
              <b>{r.task}</b>
              <span className={`tag ${r.outcome === 'ok' ? 'accepted' : 'failed'}`}>{r.outcome}</span>
              <span className="small muted">
                {modelLabel(r.model)} · {r.attempt_count} attempt{r.attempt_count === 1 ? '' : 's'} ·{' '}
                {r.input_tokens ?? 0}/{r.output_tokens ?? 0} tokens · {((r.latency_ms ?? 0) / 1000).toFixed(1)}s
              </span>
              {r.error && <span className="error small run-error">{r.error}</span>}
            </button>
            {open === r.id && <RunDetail id={r.id} />}
          </li>
        ))}
      </ul>
    </section>
  )
}

function RunDetail({ id }: { id: string }) {
  const { data: run, error } = useApi<AiRunDetail>(`/ai-runs/${id}`)
  const [copied, setCopied] = useState(false)
  if (error) return <p className="error">{error}</p>
  if (!run) return <p className="muted small">Loading…</p>
  const copy = async () => {
    await navigator.clipboard.writeText(JSON.stringify(run, null, 2))
    setCopied(true)
  }
  return (
    <div className="ai-run-detail">
      <div className="row small muted">
        <span>
          Run {run.id} · prompt <code>prompts/{run.prompt_name}.txt</code>
        </span>
        <button className="btn link small" onClick={copy}>
          {copied ? 'Copied' : 'Copy as JSON'}
        </button>
      </div>
      {run.attempts.map((a, i) => (
        <div key={i}>
          <h4>
            Attempt {i + 1}
            {a.stop_reason && <span className="small muted"> · stop: {a.stop_reason}</span>}
          </h4>
          {a.validation_errors.length > 0 && <pre className="code-block error-block">{a.validation_errors.join('\n')}</pre>}
          {a.raw_output && <pre className="code-block">{pretty(a.raw_output)}</pre>}
        </div>
      ))}
      <details>
        <summary>Request sent</summary>
        <pre className="code-block">{JSON.stringify(run.request, null, 2)}</pre>
      </details>
    </div>
  )
}

function pretty(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

