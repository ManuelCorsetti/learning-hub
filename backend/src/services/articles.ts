// Imports the v0.1 articles in seed/articles as teaching-only lessons (origin imported_article).
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DIAGRAM_KEYS, type DiagramKey } from '../../../shared/domain'
import type { Block } from '../../../shared/lessons'
import { config } from '../config'
import { get, type Db } from '../db/connection'
import { createLesson } from './lessons'

export interface Article {
  id: string
  title: string
  sections: {
    id: string
    title: string
    body: string
    callout?: string
    visual?: string
    steps?: { title: string; text: string }[]
  }[]
}

/** Section → blocks: body + callout → concept, steps → steps (body as intro), visual → diagram. */
export function articleToBlocks(article: Article): Block[] {
  const blocks: Block[] = []
  for (const s of article.sections) {
    if (s.steps) {
      blocks.push({ type: 'steps', id: s.id, title: s.title, intro: s.body, steps: s.steps })
    } else {
      blocks.push({ type: 'concept', id: s.id, title: s.title, body_markdown: s.body, callout: s.callout ?? null })
    }
    if (s.visual) {
      if (!DIAGRAM_KEYS.includes(s.visual as DiagramKey)) throw new Error(`Unknown diagram "${s.visual}" in ${article.id}`)
      blocks.push({ type: 'diagram', id: `${s.id}-diagram`, diagram_key: s.visual as DiagramKey, caption: null })
    }
    if (s.steps && s.callout) {
      blocks.push({ type: 'concept', id: `${s.id}-note`, title: s.title, body_markdown: s.callout, callout: null })
    }
  }
  return blocks
}

/**
 * Imports each article whose title matches a live topic and that has not been imported yet.
 * Returns the titles imported. Safe to run on every start.
 */
export function importSeedArticles(db: Db, dir = join(config.seedDir, 'articles')): string[] {
  const imported: string[] = []
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const article = JSON.parse(readFileSync(join(dir, file), 'utf8')) as Article
    const topic = get<{ id: string }>(
      db,
      'SELECT id FROM topics WHERE lower(title) = lower(?) AND archived_at IS NULL',
      article.title,
    )
    if (!topic) continue
    const already = get(
      db,
      `SELECT 1 FROM lessons WHERE origin = 'imported_article' AND lower(title) = lower(?)`,
      article.title,
    )
    if (already) continue
    createLesson(db, {
      topicId: topic.id,
      title: article.title,
      origin: 'imported_article',
      blocks: articleToBlocks(article),
      createdBy: 'user',
      changeNote: `Imported from seed/articles/${file}`,
    })
    imported.push(article.title)
  }
  return imported
}
