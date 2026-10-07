import { STATUS_LABELS, TOPIC_STATUSES, type TopicStatus } from '../../../shared/domain'
import type { TopicStatusInfo } from '../../../shared/api'

export function StatusBar({ counts }: { counts: Record<TopicStatus, number> }) {
  const total = counts.solid + counts.learning + counts.backlog
  return (
    <div className="status-bar" aria-hidden="true">
      {total === 0 ? (
        <div className="backlog" style={{ flex: 1, opacity: 0.4 }} />
      ) : (
        (['solid', 'learning', 'backlog'] as const).map((s) =>
          counts[s] ? <div key={s} className={s} style={{ flex: `${counts[s]} 1 0%` }} /> : null,
        )
      )}
    </div>
  )
}

export const legendText = (counts: Record<TopicStatus, number>) =>
  `${counts.solid} solid · ${counts.learning} learning · ${counts.backlog} backlog`

export function StatusPill({ status }: { status: TopicStatusInfo }) {
  return (
    <span
      className={`status-pill ${status.effective}`}
      title={status.override ? `Set by you. Measured: ${STATUS_LABELS[status.derived]}` : 'Measured'}
    >
      {STATUS_LABELS[status.effective]}
      {status.override && <span className="flag">✎</span>}
    </span>
  )
}

export function masteryText(status: TopicStatusInfo): string {
  const measured =
    status.mastery === null
      ? 'Mastery: not measured yet. Lessons and tests arrive in Phase 2.'
      : `Mastery: ${Math.round(status.mastery * 100)}% (measured).`
  if (!status.override) return measured
  const label = status.override === 'solid' ? 'Solid (self-assessed)' : STATUS_LABELS[status.override]
  return `${label} is your override; measured status is ${STATUS_LABELS[status.derived].toLowerCase()}. ${measured}`
}

export const STATUS_ORDER = TOPIC_STATUSES

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
