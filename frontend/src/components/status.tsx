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

export const percent = (value: number) => `${Math.round(value * 100)}%`

export function masteryText(status: TopicStatusInfo): string {
  const due = status.reviewsDue ? ` ${status.reviewsDue} review${status.reviewsDue === 1 ? '' : 's'} due.` : ''
  const measured =
    status.mastery === null
      ? 'Mastery: not measured yet. Build a lesson to start measuring.'
      : `Mastery: ${percent(status.mastery)} (measured).${due}`
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

/** "in 10 minutes", "in 3 days", "2 hours ago", "in under a minute". */
export function relativeTime(iso: string, now = Date.now()): string {
  const diff = new Date(iso).getTime() - now
  const abs = Math.abs(diff)
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['day', 86_400_000],
    ['hour', 3_600_000],
    ['minute', 60_000],
  ]
  const fmt = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  for (const [unit, ms] of units) if (abs >= ms) return fmt.format(Math.round(diff / ms), unit)
  return diff > 0 ? 'in under a minute' : 'just now'
}
