// Notes & edits: write a note about the lesson or one block; Claude replies and may suggest an
// edit, shown as a diff. Accepting saves a new version. Also the version history, with restore.
import { useEffect, useState, type FormEvent } from 'react'
import type { ChatMessageView, LessonPatchView, LessonView, PatchChange } from '../../../shared/api'
import type { Block } from '../../../shared/lessons'
import { api, useAction, useApi } from '../api'
import { BlockPreview, blockKind } from './lesson/BlockPreview'
import { formatDateTime } from './status'

const blockLabel = (b: Block | undefined) => (b ? ('title' in b ? b.title : blockKind(b)) : 'a block')

export function CoauthorPanel({
  lesson,
  blockId,
  setBlockId,
  aiAvailable,
  onClose,
}: {
  lesson: LessonView
  blockId: string | null
  setBlockId: (id: string | null) => void
  aiAvailable: boolean
  onClose: () => void
}) {
  const { data: messages, error } = useApi<ChatMessageView[]>(`/lessons/${lesson.id}/thread`)
  const [tab, setTab] = useState<'notes' | 'history'>('notes')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  useEffect(() => {
    if (blockId) setTab('notes')
  }, [blockId])

  return (
    <aside className="panel coauthor" aria-label="Notes and edits">
      <div className="panel-head">
        <div className="tabs" role="tablist">
          <button className={tab === 'notes' ? 'active' : ''} onClick={() => setTab('notes')}>
            Notes & edits
          </button>
          <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>
            History · v{lesson.version.version_no}
          </button>
        </div>
        <button className="icon-btn close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {tab === 'notes' ? (
        <Notes lesson={lesson} messages={messages ?? []} blockId={blockId} setBlockId={setBlockId} aiAvailable={aiAvailable} />
      ) : (
        <History lesson={lesson} />
      )}
    </aside>
  )
}

function Notes({
  lesson,
  messages,
  blockId,
  setBlockId,
  aiAvailable,
}: {
  lesson: LessonView
  messages: ChatMessageView[]
  blockId: string | null
  setBlockId: (id: string | null) => void
  aiAvailable: boolean
}) {
  const [text, setText] = useState('')
  const { busy, error, run } = useAction()
  const byId = new Map(lesson.blocks.map((b) => [b.id, b]))
  const send = async (e: FormEvent) => {
    e.preventDefault()
    if (await run(() => api.post(`/lessons/${lesson.id}/thread`, { message: text, block_id: blockId }))) {
      setText('')
      setBlockId(null)
    }
  }
  return (
    <div className="stack">
      <p className="small muted">
        Write a note about the lesson, or use <b>Note</b> on any block. Claude replies and may suggest an edit; nothing
        changes until you accept it. Your notes also shape future lessons on this topic.
      </p>
      {messages.map((m) =>
        m.role === 'user' ? (
          <div key={m.id} className="chat-msg user">
            {m.block_id && <span className="card-label">On {blockLabel(byId.get(m.block_id))}</span>}
            {m.content}
          </div>
        ) : (
          <div key={m.id} className="chat-msg assistant">
            <p>{m.content}</p>
            {m.patch && <PatchCard patch={m.patch} />}
          </div>
        ),
      )}
      {busy && (
        <p className="working">
          <span className="spinner" /> Claude is reading the lesson and drafting a reply.
        </p>
      )}
      <form className="stack" onSubmit={send}>
        {blockId && (
          <span className="chip">
            About: {blockLabel(byId.get(blockId))}
            <button type="button" onClick={() => setBlockId(null)} aria-label="Note on the whole lesson">
              ×
            </button>
          </span>
        )}
        <textarea
          rows={3}
          value={text}
          disabled={busy || !aiAvailable}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            aiAvailable
              ? 'e.g. "Too abstract, use a BigQuery MERGE example" or "Add a trick question about late events"'
              : 'Set ANTHROPIC_API_KEY to co-author lessons with Claude'
          }
        />
        <div>
          <button className="btn small primary" disabled={busy || !aiAvailable || !text.trim()}>
            Send note
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </form>
    </div>
  )
}

const CHANGE_LABELS: Record<PatchChange['kind'], string> = { changed: 'Changed', added: 'Added', removed: 'Removed', moved: 'Moved' }
const SCHEDULE_LABELS = {
  kept: 'review history kept',
  reset: 'review schedule restarts',
  new: 'new question',
  retired: 'reviews stop',
}

function PatchCard({ patch }: { patch: LessonPatchView }) {
  const { busy, error, run } = useAction()
  const pending = patch.status === 'pending'
  return (
    <div className={`patch ${patch.status}`}>
      <div className="row">
        <b>Suggested edit: {patch.change_note}</b>
        {!pending && <span className={`tag ${patch.status}`}>{patch.status}</span>}
      </div>
      {patch.changes.map((c, i) => (
        <div key={i} className={`change ${c.kind}`}>
          <div className="change-head">
            <span className="kind">{CHANGE_LABELS[c.kind]}</span>
            <span className="small muted">{c.kind === 'moved' ? `${blockLabel(c.before ?? undefined)} → ${c.where}` : c.where}</span>
            {c.schedule && <span className={`schedule ${c.schedule}`}>{SCHEDULE_LABELS[c.schedule]}</span>}
          </div>
          {c.kind === 'changed' ? (
            <div className="before-after">
              {c.before && (
                <div className="before">
                  <BlockPreview block={c.before} />
                </div>
              )}
              {c.after && (
                <div className="after">
                  <BlockPreview block={c.after} />
                </div>
              )}
            </div>
          ) : c.kind !== 'moved' && (c.after ?? c.before) ? (
            <div className={c.kind === 'added' ? 'after' : 'before'}>
              <BlockPreview block={(c.after ?? c.before)!} />
            </div>
          ) : null}
        </div>
      ))}
      {pending && patch.stale && (
        <p className="notice">The lesson has changed since this was suggested. Send the note again for a fresh edit.</p>
      )}
      {pending && !patch.stale && (
        <div className="row">
          <button className="btn small primary" disabled={busy} onClick={() => run(() => api.post(`/proposals/${patch.proposal_id}/accept`))}>
            Accept: save as v{patch.base_version_no + 1}
          </button>
          <button className="btn small" disabled={busy} onClick={() => run(() => api.post(`/proposals/${patch.proposal_id}/reject`))}>
            Reject
          </button>
        </div>
      )}
      {patch.decision_note && <p className="small muted">{patch.decision_note}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  )
}

function History({ lesson }: { lesson: LessonView }) {
  const { busy, error, run } = useAction()
  const restore = (versionId: string, no: number) => {
    if (confirm(`Restore version ${no}? This saves a copy of it as a new version; nothing is deleted.`)) {
      void run(() => api.post(`/lessons/${lesson.id}/versions/${versionId}/restore`))
    }
  }
  return (
    <div className="stack">
      <p className="small muted">
        Every edit is a new version. Restoring copies an older version forward. Questions that keep their id keep their
        review history.
      </p>
      <ul className="timeline">
        {lesson.versions.map((v) => (
          <li key={v.id}>
            <time dateTime={v.created_at}>{formatDateTime(v.created_at)}</time>
            <span className="grow">
              <b>v{v.version_no}</b> · {v.created_by === 'ai' ? 'Claude' : 'you'} · {v.questionCount} question
              {v.questionCount === 1 ? '' : 's'}
              {v.change_note && <div className="small muted">{v.change_note}</div>}
            </span>
            {v.id === lesson.version.id ? (
              <span className="tag accepted">current</span>
            ) : (
              <button className="btn small" disabled={busy} onClick={() => restore(v.id, v.version_no)}>
                Restore
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="error">{error}</p>}
    </div>
  )
}
