// The small Markdown subset lesson text uses: paragraphs, bullet and numbered lists,
// fenced code, **bold**, *italic* and `code`. Rendered as React elements, never as HTML.
import type { ReactNode } from 'react'

// Code spans open and close with the same run of backticks, so `` `a`.`b` `` can hold backticks
// (BigQuery names). Underscore emphasis needs a word boundary, so dbt_alice stays as written.
const INLINE = /(?<!`)(`+)(?!`)([\s\S]*?[^`])\1(?!`)|\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|(?<!\w)_([^_\s][^_]*)_(?!\w)/g

export type InlinePart = string | { code: string } | { strong: string } | { em: string }

export function parseInline(text: string): InlinePart[] {
  const parts: InlinePart[] = []
  let last = 0
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    // One space on each side is padding, as in CommonMark: `` `x` `` is the code `x`.
    if (m[1]) parts.push({ code: /^ .* $/s.test(m[2]) && m[2].trim() ? m[2].slice(1, -1) : m[2] })
    else if (m[3] !== undefined) parts.push({ strong: m[3] })
    else parts.push({ em: m[4] ?? m[5] })
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

export function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((p, i) =>
        typeof p === 'string' ? p : 'code' in p ? <code key={i}>{p.code}</code> : 'strong' in p ? <strong key={i}>{p.strong}</strong> : <em key={i}>{p.em}</em>,
      )}
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
