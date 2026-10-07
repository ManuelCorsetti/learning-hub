import { useEffect, useState } from 'react'

export type Route =
  | { page: 'home' }
  | { page: 'area'; areaId: string; topicId: string | null; view: AreaView }
  | { page: 'review' }
  | { page: 'goals' }

export type AreaView = 'list' | 'graph'

export function parseRoute(hash: string): Route {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?')
  const parts = path.split('/').filter(Boolean)
  const params = new URLSearchParams(query)
  if (parts[0] === 'areas' && parts[1]) {
    return {
      page: 'area',
      areaId: parts[1],
      topicId: params.get('topic'),
      view: params.get('view') === 'graph' ? 'graph' : 'list',
    }
  }
  if (parts[0] === 'review') return { page: 'review' }
  if (parts[0] === 'goals') return { page: 'goals' }
  return { page: 'home' }
}

export function areaHref(areaId: string | null, topicId?: string | null, view: AreaView = 'list'): string {
  const params = new URLSearchParams()
  if (topicId) params.set('topic', topicId)
  if (view === 'graph') params.set('view', 'graph')
  const query = params.toString()
  return `#/areas/${areaId ?? 'inbox'}${query ? `?${query}` : ''}`
}

export function navigate(href: string) {
  window.location.hash = href.replace(/^#/, '')
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash))
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

