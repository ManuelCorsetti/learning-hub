import type { z } from 'zod'
import type { UpdateAreaInput } from '../../../shared/api'
import { get, run, type Db } from '../db/connection'
import { clean, conflict, newId, notFound, nowIso } from '../lib'

export interface AreaRow {
  id: string
  name: string
  summary: string | null
  position: number
  archived_at: string | null
  created_at: string
  updated_at: string
}

export function getArea(db: Db, id: string): AreaRow | undefined {
  return get<AreaRow>(db, 'SELECT * FROM areas WHERE id = ?', id)
}

export function requireLiveArea(db: Db, id: string): AreaRow {
  const area = getArea(db, id)
  if (!area || area.archived_at) throw notFound('Area')
  return area
}

function assertNameFree(db: Db, name: string, exceptId: string | null = null): void {
  const clash = get<{ id: string }>(
    db,
    'SELECT id FROM areas WHERE lower(name) = lower(?) AND archived_at IS NULL AND id IS NOT ?',
    name,
    exceptId,
  )
  if (clash) throw conflict(`An area called "${name}" already exists`)
}

export function createArea(db: Db, input: { id?: string; name: string; summary?: string | null }): AreaRow {
  const name = input.name.trim()
  assertNameFree(db, name)
  const id = input.id ?? newId()
  const now = nowIso()
  const position =
    (get<{ p: number | null }>(db, 'SELECT max(position) AS p FROM areas WHERE archived_at IS NULL')?.p ?? 0) + 1
  run(
    db,
    `INSERT INTO areas (id, name, summary, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
    id,
    name,
    clean(input.summary),
    position,
    now,
    now,
  )
  return getArea(db, id)!
}

export function updateArea(db: Db, id: string, patch: z.infer<typeof UpdateAreaInput>): AreaRow {
  const area = requireLiveArea(db, id)
  const name = patch.name?.trim() ?? area.name
  if (name.toLowerCase() !== area.name.toLowerCase()) assertNameFree(db, name, id)
  run(
    db,
    'UPDATE areas SET name = ?, summary = ?, position = ?, updated_at = ? WHERE id = ?',
    name,
    patch.summary === undefined ? area.summary : clean(patch.summary),
    patch.position ?? area.position,
    nowIso(),
    id,
  )
  return getArea(db, id)!
}

export function archiveArea(db: Db, id: string): void {
  requireLiveArea(db, id)
  const live = get<{ n: number }>(db, 'SELECT count(*) AS n FROM topics WHERE area_id = ? AND archived_at IS NULL', id)
  if (live && live.n > 0) throw conflict('Move or archive the topics in this area first')
  run(db, 'UPDATE areas SET archived_at = ?, updated_at = ? WHERE id = ?', nowIso(), nowIso(), id)
}
