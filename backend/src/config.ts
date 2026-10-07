import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

// Optional .env at the repo root; variables already set in the shell win.
const envFile = join(ROOT, '.env')
if (existsSync(envFile)) process.loadEnvFile(envFile)

export const config = {
  port: Number(process.env.PORT ?? 8787),
  dbPath: resolve(ROOT, process.env.DB_PATH ?? join('data', 'learning-studio.db')),
  model: process.env.LEARNING_MODEL ?? 'claude-opus-5-5',
  promptsDir: join(ROOT, 'prompts'),
  seedDir: join(ROOT, 'seed'),
  distDir: join(ROOT, 'dist'),
}
