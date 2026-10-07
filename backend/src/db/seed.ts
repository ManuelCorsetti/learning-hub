import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ResourceKind } from '../../../shared/domain'
import { config } from '../config'
import { createArea } from '../services/areas'
import { SYSTEM } from '../services/events'
import { addResource } from '../services/goals'
import { createTopic } from '../services/topics'
import { get, tx, type Db } from './connection'

interface SeedFile {
  areas: { key: string; name: string; summary: string }[]
  topics: {
    area: string
    title: string
    summary: string
    why_i_care?: string
    resources?: { kind: ResourceKind; title: string; url?: string; note?: string }[]
  }[]
}

/** Loads seed/seed.json into an empty database. Returns false if there is already data. */
export function seedIfEmpty(db: Db, path = join(config.seedDir, 'seed.json')): boolean {
  const hasData = get(db, 'SELECT 1 FROM areas UNION ALL SELECT 1 FROM topics LIMIT 1')
  if (hasData) return false
  const seed = JSON.parse(readFileSync(path, 'utf8')) as SeedFile
  tx(db, () => {
    const areaIds = new Map<string, string>()
    for (const a of seed.areas) areaIds.set(a.key, createArea(db, { name: a.name, summary: a.summary }).id)
    for (const t of seed.topics) {
      const topic = createTopic(db, SYSTEM, {
        title: t.title,
        summary: t.summary,
        why_i_care: t.why_i_care ?? null,
        area_id: areaIds.get(t.area) ?? null,
      })
      for (const r of t.resources ?? []) {
        addResource(db, topic.id, { kind: r.kind, title: r.title, url: r.url ?? null, note: r.note ?? null })
      }
    }
  })
  return true
}
