// Read models for the home page, area pages and graph view.
import type { TopicStatus } from '../../../shared/domain'
import type { AreaDetail, AreaSummary, GraphData, GraphEdge, GraphNode, HomeData } from '../../../shared/api'
import { all, get, type Db } from '../db/connection'
import type { LinkType } from '../../../shared/domain'
import type { AreaRow } from './areas'
import { requireLiveArea } from './areas'
import { pendingCount, pendingCountsByArea } from './proposals'
import { listTopics, resolveOverrides, toListItems, type TopicRow } from './topics'

const CHIP_COUNT = 4

export function listAreaSummaries(db: Db): AreaSummary[] {
  const areas = all<AreaRow>(db, 'SELECT * FROM areas WHERE archived_at IS NULL ORDER BY position, lower(name)')
  const topics = listTopics(db)
  const pending = pendingCountsByArea(db)
  return areas.map((area) => {
    const own = topics.filter((t) => t.area_id === area.id)
    const counts: Record<TopicStatus, number> = { backlog: 0, learning: 0, solid: 0 }
    for (const t of own) counts[t.status.effective]++
    const measured = own.map((t) => t.status.mastery).filter((m): m is number => m !== null)
    // Learning first, then backlog, then solid: the chips show what is active.
    const order: Record<TopicStatus, number> = { learning: 0, backlog: 1, solid: 2 }
    const chips = [...own].sort((a, b) => order[a.status.effective] - order[b.status.effective]).map((t) => t.title)
    return {
      id: area.id,
      name: area.name,
      summary: area.summary,
      position: area.position,
      counts,
      topicCount: own.length,
      chips: chips.slice(0, CHIP_COUNT),
      pendingProposals: pending.get(area.id) ?? 0,
      mastery: measured.length ? measured.reduce((a, b) => a + b, 0) / measured.length : null,
    }
  })
}

export function getHome(db: Db, aiAvailable: boolean): HomeData {
  resolveOverrides(db)
  const areas = listAreaSummaries(db)
  const inboxCount =
    get<{ n: number }>(db, 'SELECT count(*) AS n FROM topics WHERE archived_at IS NULL AND area_id IS NULL')?.n ?? 0
  return {
    areas,
    inboxCount,
    topicCount: areas.reduce((sum, a) => sum + a.topicCount, 0) + inboxCount,
    pendingProposals: pendingCount(db),
    aiAvailable,
  }
}

/** areaId 'inbox' lists topics that have no area yet. */
export function getAreaDetail(db: Db, areaId: string): AreaDetail {
  if (areaId === 'inbox') return { area: null, topics: listTopics(db, null) }
  const area = requireLiveArea(db, areaId)
  return {
    area: { id: area.id, name: area.name, summary: area.summary, position: area.position },
    topics: listTopics(db, area.id),
  }
}

/**
 * Topics in the area, plus topics in other areas they link to (marked external),
 * plus the goals those topics serve.
 */
export function getAreaGraph(db: Db, areaId: string): GraphData {
  const own = all<TopicRow>(
    db,
    'SELECT * FROM topics WHERE archived_at IS NULL AND area_id IS ?',
    areaId === 'inbox' ? null : requireLiveArea(db, areaId).id,
  )
  const ownIds = new Set(own.map((t) => t.id))
  const links = all<{ id: string; from_topic_id: string; to_topic_id: string; link_type: LinkType }>(
    db,
    `SELECT l.id, l.from_topic_id, l.to_topic_id, l.link_type FROM topic_links l
     JOIN topics a ON a.id = l.from_topic_id AND a.archived_at IS NULL
     JOIN topics b ON b.id = l.to_topic_id AND b.archived_at IS NULL`,
  ).filter((l) => ownIds.has(l.from_topic_id) || ownIds.has(l.to_topic_id))

  const externalIds = new Set(
    links.flatMap((l) => [l.from_topic_id, l.to_topic_id]).filter((id) => !ownIds.has(id)),
  )
  const external = externalIds.size
    ? all<TopicRow & { area_name: string | null }>(
        db,
        `SELECT t.*, a.name AS area_name FROM topics t LEFT JOIN areas a ON a.id = t.area_id
         WHERE t.id IN (${[...externalIds].map(() => '?').join(',')})`,
        ...externalIds,
      )
    : []

  const items = toListItems(db, [...own, ...external])
  const nodes: GraphNode[] = items.map((t) => ({
    id: t.id,
    kind: 'topic',
    label: t.title,
    status: t.status.effective,
    external: !ownIds.has(t.id),
    areaName: external.find((e) => e.id === t.id)?.area_name ?? null,
  }))
  const edges: GraphEdge[] = links.map((l) => ({
    id: l.id,
    source: l.from_topic_id,
    target: l.to_topic_id,
    kind: l.link_type,
  }))

  const goalLinks = ownIds.size
    ? all<{ goal_id: string; title: string; topic_id: string }>(
        db,
        `SELECT g.id AS goal_id, g.title, tg.topic_id FROM topic_goals tg JOIN goals g ON g.id = tg.goal_id
         WHERE g.status = 'active' AND tg.topic_id IN (${[...ownIds].map(() => '?').join(',')})`,
        ...ownIds,
      )
    : []
  for (const g of goalLinks) {
    if (!nodes.some((n) => n.id === g.goal_id)) {
      nodes.push({ id: g.goal_id, kind: 'goal', label: g.title, status: null, external: false, areaName: null })
    }
    edges.push({ id: `${g.topic_id}-${g.goal_id}`, source: g.topic_id, target: g.goal_id, kind: 'serves_goal' })
  }
  return { nodes, edges }
}
