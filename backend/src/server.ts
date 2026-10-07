import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { aiConfigured } from './ai/client'
import { createApp } from './app'
import { config, ROOT } from './config'
import { openDb } from './db/connection'
import { seedIfEmpty } from './db/seed'
import { importSeedArticles } from './services/articles'
import { rebuildIfStale } from './services/scheduler'

const db = openDb(config.dbPath)
if (seedIfEmpty(db)) console.log('Seeded the starter areas and topics.')
for (const title of importSeedArticles(db)) console.log(`Imported the "${title}" article as a lesson.`)
if (rebuildIfStale(db)) console.log('Rebuilt review schedules for the current scheduler version.')

const app = new Hono()
app.route('/', createApp(db))

// `npm start` after `npm run build` serves the built frontend; in dev, Vite serves it.
if (existsSync(config.distDir)) {
  const root = join(ROOT, 'dist').replaceAll('\\', '/')
  app.use('/*', serveStatic({ root }))
  app.get('*', (c) => c.html(readFileSync(join(config.distDir, 'index.html'), 'utf8')))
}

serve({ fetch: app.fetch, port: config.port }, ({ port }) => {
  console.log(`Learning Studio API on http://localhost:${port}`)
  console.log(`Database: ${config.dbPath}`)
  console.log(aiConfigured() ? `AI: ${config.model}` : 'AI: not configured (set ANTHROPIC_API_KEY to enable Capture and Organise)')
})
