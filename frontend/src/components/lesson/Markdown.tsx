// The small Markdown subset lesson text uses: paragraphs, bullet and numbered lists,
// fenced code, **bold**, *italic* and `code`. Rendered as React elements, never as HTML.
import type { ReactNode } from 'react'

const INLINE = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g

export function Inline({ text }: { text: string }) {
  const parts = text.split(INLINE).filter(Boolean)
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith('`') && p.endsWith('`') && p.length > 1) return <code key={i}>{p.slice(1, -1)}</code>
        if (p.startsWith('**') && p.endsWith('**') && p.length > 3) return <strong key={i}>{p.slice(2, -2)}</strong>
        if ((p.startsWith('*') && p.endsWith('*')) || (p.startsWith('_') && p.endsWith('_'))) {
          if (p.length > 2) return <em key={i}>{p.slice(1, -1)}</em>
        }
        return p
      })}
    </>
  )
}

export function Markdown({ text }: { text: string }) {
  const out: ReactNode[] = []
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }
    if (line.trimStart().startsWith('```')) {
      const code: string[] = []
      i++
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) code.push(lines[i++])
      i++
      out.push(
        <pre key={out.length} className="code-block">
          <code>{code.join('\n')}</code>
        </pre>,
      )
      continue
    }
    const bullet = /^\s*[-*]\s+/
    const numbered = /^\s*\d+[.)]\s+/
    if (bullet.test(line) || numbered.test(line)) {
      const marker = bullet.test(line) ? bullet : numbered
      const items: string[] = []
      while (i < lines.length && marker.test(lines[i])) items.push(lines[i++].replace(marker, ''))
      const List = marker === bullet ? 'ul' : 'ol'
      out.push(
        <List key={out.length}>
          {items.map((item, j) => (
            <li key={j}>
              <Inline text={item} />
            </li>
          ))}
        </List>,
      )
      continue
    }
    const para: string[] = []
    while (i < lines.length && lines[i].trim() && !lines[i].trimStart().startsWith('```') && !bullet.test(lines[i]) && !numbered.test(lines[i])) {
      para.push(lines[i++].trim())
    }
    out.push(
      <p key={out.length}>
        <Inline text={para.join(' ')} />
      </p>,
    )
  }
  return <div className="md">{out}</div>
}
