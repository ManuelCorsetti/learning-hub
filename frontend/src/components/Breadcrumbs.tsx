// Map › Area › Topic › Sub-topic › Lesson. The last item is the current page.
export function Breadcrumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      {items.map((item, i) => (
        <span key={i}>
          {i > 0 && <span className="sep">›</span>}
          {item.href && i < items.length - 1 ? <a href={item.href}>{item.label}</a> : <span aria-current="page">{item.label}</span>}
        </span>
      ))}
    </nav>
  )
}

/** Crumbs for a topic: Map › Area › Parent › Topic. */
export function topicCrumbs(topic: {
  id: string
  title: string
  area: { id: string; name: string } | null
  parent: { id: string; title: string } | null
}): { label: string; href?: string }[] {
  return [
    { label: 'Map', href: '#/' },
    { label: topic.area?.name ?? 'Inbox', href: `#/areas/${topic.area?.id ?? 'inbox'}` },
    ...(topic.parent ? [{ label: topic.parent.title, href: `#/topics/${topic.parent.id}` }] : []),
    { label: topic.title, href: `#/topics/${topic.id}` },
  ]
}
