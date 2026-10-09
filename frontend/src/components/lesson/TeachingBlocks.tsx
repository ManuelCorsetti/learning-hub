import type { BlockOf } from '../../../../shared/lessons'
import { DIAGRAMS } from './Diagrams'
import { Inline, Markdown } from './Markdown'

export function Callout({ text }: { text: string }) {
  return (
    <div className="callout">
      <span className="spark" aria-hidden="true">
        ✦
      </span>
      <p>
        <Inline text={text} />
      </p>
    </div>
  )
}

export function ConceptBlock({ block }: { block: BlockOf<'concept'> }) {
  return (
    <>
      <Markdown text={block.body_markdown} />
      {block.callout && <Callout text={block.callout} />}
    </>
  )
}

export function StepsBlock({ block }: { block: BlockOf<'steps'> }) {
  return (
    <>
      {block.intro && <Markdown text={block.intro} />}
      <div className="steps">
        {block.steps.map((s, i) => (
          <div className="step" key={i}>
            <span>{i + 1}</span>
            <div>
              <b>{s.title}</b>
              <p>
                <Inline text={s.text} />
              </p>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

export function DiagramBlock({ block }: { block: BlockOf<'diagram'> }) {
  const Diagram = DIAGRAMS[block.diagram_key]
  if (!Diagram) return <p className="small muted">Unknown diagram "{block.diagram_key}".</p>
  return (
    <figure className="diagram">
      <Diagram />
      {block.caption && <figcaption>{block.caption}</figcaption>}
    </figure>
  )
}
