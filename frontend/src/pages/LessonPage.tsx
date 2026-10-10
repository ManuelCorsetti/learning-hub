// A lesson: the latest version's blocks in order, in the v0.1 article layout
// (sticky table of contents on the left). Questions are answered inline.
import { useState, type CSSProperties } from 'react'
import type { LessonView, Measurement } from '../../../shared/api'
import { isInteractive, type Block, type InteractiveBlock } from '../../../shared/lessons'
import { api, useAction, useApi } from '../api'
import { QuestionCard } from '../components/lesson/Questions'
import { ConceptBlock, DiagramBlock, StepsBlock } from '../components/lesson/TeachingBlocks'
import { useStudySession } from '../components/lesson/useStudySession'
import { formatDate, percent } from '../components/status'
import { Breadcrumbs, topicCrumbs } from '../components/Breadcrumbs'
import { CoauthorPanel } from '../components/CoauthorPanel'

interface Section {
  id: string
  title: string
  blocks: Block[]
}

/** A new section starts at each concept or steps block; diagrams and questions belong to the one before. */
function toSections(blocks: Block[]): { sections: Section[]; project: InteractiveBlock | null } {
  const sections: Section[] = []
  let project: InteractiveBlock | null = null
  for (const b of blocks) {
    if (b.type === 'project_prompt') project = b
    else if (b.type === 'concept' || b.type === 'steps') sections.push({ id: b.id, title: b.title, blocks: [b] })
    else if (sections.length) sections.at(-1)!.blocks.push(b)
    else sections.push({ id: b.id, title: 'Introduction', blocks: [b] })
  }
  return { sections, project }
}

const label = (i: number) => String(i + 1).padStart(2, '0')

export function LessonPage({ lessonId, aiAvailable }: { lessonId: string; aiAvailable: boolean }) {
  const { data: lesson, error } = useApi<LessonView>(`/lessons/${lessonId}`)
  // Kept outside <Lesson> so the panel stays open when an accepted edit loads the new version.
  const [coauthor, setCoauthor] = useState<{ open: boolean; blockId: string | null; draft?: string }>({ open: false, blockId: null })
  if (error) return <p className="error">{error}</p>
  if (!lesson) return <p className="muted">Loading…</p>
  return (
    <>
      <Lesson
        key={lesson.version.id}
        lesson={lesson}
        aiAvailable={aiAvailable}
        onNote={(blockId, draft) => setCoauthor({ open: true, blockId, draft })}
      />
      {coauthor.open && (
        <CoauthorPanel
          lesson={lesson}
          blockId={coauthor.blockId}
          draft={coauthor.draft}
          setBlockId={(blockId) => setCoauthor({ open: true, blockId })}
          aiAvailable={aiAvailable}
          onClose={() => setCoauthor({ open: false, blockId: null })}
        />
      )}
    </>
  )
}

function Lesson({ lesson, aiAvailable, onNote }: { lesson: LessonView; aiAvailable: boolean; onNote: (blockId: string | null, draft?: string) => void }) {
  const placement = lesson.origin === 'placement'
  const record = useStudySession(placement ? 'placement' : 'lesson', lesson.version.id)
  const { sections, project } = toSections(lesson.blocks)
  const questions = lesson.blocks.filter(isInteractive)
  const scroll = (id: string) => document.getElementById(`block-${id}`)?.scrollIntoView({ behavior: 'smooth' })

  const renderBlock = (b: Block) => {
    switch (b.type) {
      case 'concept':
        return <ConceptBlock block={b} />
      case 'steps':
        return <StepsBlock block={b} />
      case 'diagram':
        return <DiagramBlock block={b} />
      default:
        return (
          <QuestionCard
            block={b}
            progress={lesson.items[b.id]}
            onSubmit={(answer, confidence) => record(lesson.items[b.id].review_item_id, answer, confidence)}
            onDiscuss={(note) => onNote(b.id, note)}
          />
        )
    }
  }

  return (
    <div className="lesson">
      <Breadcrumbs items={[...topicCrumbs(lesson.topic), { label: lesson.title }]} />
      <div className="article-heading">
        <div>
          <span className="eyebrow">
            {placement ? 'Placement test' : 'Lesson'} · v{lesson.version.version_no} · {lesson.version.created_by === 'ai' ? 'written by Claude' : 'yours'} ·{' '}
            {formatDate(lesson.version.created_at)}
          </span>
          <h1>{lesson.title}</h1>
          <p className="lede">
            {placement
              ? 'Answer every question without looking anything up, and say honestly how sure you are. Your answers measure what you already know; questions come back in Practice like any other.'
              : questions.length
              ? 'Read each part, then answer its questions. Say how sure you are before you see the answer: your answers schedule the reviews.'
              : 'This lesson has no questions yet, so it cannot measure what you remember.'}
          </p>
          {!questions.length && <AddQuestions lessonId={lesson.id} aiAvailable={aiAvailable} />}
        </div>
        <button className="btn" onClick={() => onNote(null)}>
          ✎ Notes & edits
        </button>
      </div>
      <div className="article-layout">
        <aside className="toc">
          <span>In this lesson</span>
          {sections.map((s, i) => (
            <button key={s.id} onClick={() => scroll(s.id)}>
              <b>{label(i)}</b>
              {s.title}
            </button>
          ))}
          {project && (
            <button onClick={() => scroll(project.id)}>
              <b>✦</b>
              Project
            </button>
          )}
          <Mastery measurement={lesson.measurement} />
        </aside>
        <div className="article-body">
          {sections.map((s, i) => (
            <section className="article-section" id={`block-${s.id}`} key={s.id}>
              <div className="section-number">{label(i)}</div>
              <div>
                <h2>{s.title}</h2>
                {s.blocks.map((b) => (
                  <div key={b.id} className={`block block-${b.type}`}>
                    <button className="note-btn" onClick={() => onNote(b.id)} title="Write a note about this block">
                      ✎ Note
                    </button>
                    {renderBlock(b)}
                  </div>
                ))}
              </div>
            </section>
          ))}
          {placement && <PlacementSummary lesson={lesson} />}
          {project && (
            <section className="finish-card" id={`block-${project.id}`}>
              <span className="eyebrow">Put it to work</span>
              <QuestionCard
                block={project}
                progress={lesson.items[project.id]}
                onSubmit={(answer, confidence) => record(lesson.items[project.id].review_item_id, answer, confidence)}
              />
            </section>
          )}
        </div>
      </div>
    </div>
  )
}

function PlacementSummary({ lesson }: { lesson: LessonView }) {
  const items = Object.values(lesson.items).filter((i) => i.is_scheduled)
  const answered = items.filter((i) => i.attempts > 0)
  const right = answered.filter((i) => i.last_correct)
  return (
    <section className="finish-card">
      <span className="eyebrow">Result</span>
      <h2>
        {answered.length < items.length
          ? `${answered.length} of ${items.length} answered`
          : `${right.length} of ${items.length} right`}
      </h2>
      <p>
        {answered.length < items.length
          ? 'Answer every question to finish the test.'
          : 'Questions you missed come back in Practice within minutes, the ones you got right in days. The topic’s measured status updates as you review them, next to anything you set by hand.'}
      </p>
    </section>
  )
}

function Mastery({ measurement }: { measurement: Measurement }) {
  const value = measurement.mastery === null ? 0 : Math.round(measurement.mastery * 100)
  return (
    <div className="article-progress">
      <div className="progress-ring" style={{ '--progress': `${value * 3.6}deg` } as CSSProperties}>
        <span>{measurement.mastery === null ? '–' : `${value}%`}</span>
      </div>
      <div>
        <b>Topic mastery</b>
        <small>
          {measurement.mastery === null
            ? 'Not measured yet'
            : `${percent(measurement.coverage!)} tested · ${measurement.retention === null ? 'no' : percent(measurement.retention)} recall`}
          {measurement.reviewsDue > 0 && (
            <>
              {' · '}
              <a href="#/practice">{measurement.reviewsDue} due</a>
            </>
          )}
        </small>
      </div>
    </div>
  )
}

function AddQuestions({ lessonId, aiAvailable }: { lessonId: string; aiAvailable: boolean }) {
  const { busy, error, run } = useAction()
  return (
    <div style={{ marginTop: 18 }}>
      <button
        className="btn primary"
        disabled={!aiAvailable || busy}
        onClick={() => run(() => api.post(`/lessons/${lessonId}/questions`))}
        title={aiAvailable ? 'Claude writes questions for the existing text, saved as a new version' : 'Set ANTHROPIC_API_KEY'}
      >
        {busy ? <span className="spinner" /> : '✦'} Add questions
      </button>
      {busy && <p className="working">Claude is writing questions for this lesson. This can take a couple of minutes.</p>}
      {error && <p className="error">{error}</p>}
    </div>
  )
}
