// "Learn from my answers": Claude reads confidently-wrong answers, forgotten questions and
// decaying topics, and suggests map changes for Review.
import { useState } from 'react'
import type { OptimiseSignals } from '../../../shared/api'
import { api, useAction, useApi } from '../api'

export function OptimiseButton({ aiAvailable }: { aiAvailable: boolean }) {
  const { data: signals } = useApi<OptimiseSignals>('/optimise/signals')
  const [result, setResult] = useState<{ created: number; observations: string[] } | null>(null)
  const { busy, error, run } = useAction()
  const evidence = signals
    ? [
        signals.confidentlyWrong.length && `${signals.confidentlyWrong.length} wrong while certain`,
        signals.struggling.length && `${signals.struggling.length} often forgotten`,
        signals.decaying.length && `${signals.decaying.length} topic${signals.decaying.length === 1 ? '' : 's'} decaying`,
        signals.contradicted.length && `${signals.contradicted.length} status${signals.contradicted.length === 1 ? '' : 'es'} contradicted`,
      ].filter(Boolean)
    : []
  return (
    <div className="optimise">
      <div className="row">
        <button
          className="btn"
          disabled={!aiAvailable || busy || !evidence.length}
          onClick={async () => setResult((await run(() => api.post<{ created: number; observations: string[] }>('/optimise'))) ?? null)}
          title="Claude reads how you answer and suggests changes to your map"
        >
          {busy ? <span className="spinner" /> : '✦'} Learn from my answers
        </button>
        <span className="small muted">{evidence.length ? `Evidence: ${evidence.join(' · ')}` : 'No evidence yet: answer some questions first.'}</span>
      </div>
      {busy && <p className="working">Claude is reading your answers. This can take up to a minute.</p>}
      {error && <p className="error">{error}</p>}
      {result && (
        <div className="notice ok" style={{ marginTop: 12 }}>
          {result.observations.length > 0 && (
            <ul className="observations">
              {result.observations.map((o, i) => (
                <li key={i}>{o}</li>
              ))}
            </ul>
          )}
          {result.created ? (
            <>
              {result.created} suggestion{result.created === 1 ? '' : 's'} ready. <a href="#/review">Review them</a>
            </>
          ) : (
            'No changes to the map suggested.'
          )}
        </div>
      )}
    </div>
  )
}
