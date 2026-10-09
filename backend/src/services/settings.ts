// App settings stored in the database: which Claude model to use, and the learner profile
// that is sent with every Claude call.
import type { z } from 'zod'
import { MODELS, type Model } from '../../../shared/domain'
import { Profile, type SettingsView, type UpdateSettingsInput } from '../../../shared/api'
import { config } from '../config'
import { get, run, tx, type Db } from '../db/connection'
import { nowIso } from '../lib'

function read<T>(db: Db, key: string): T | undefined {
  const row = get<{ value_json: string }>(db, 'SELECT value_json FROM settings WHERE key = ?', key)
  return row ? (JSON.parse(row.value_json) as T) : undefined
}

function write(db: Db, key: string, value: unknown): void {
  run(
    db,
    `INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    key,
    JSON.stringify(value),
    nowIso(),
  )
}

/** The chosen model, else LEARNING_MODEL, else the default in config. */
export function currentModel(db: Db): string {
  return read<string>(db, 'model') ?? config.model
}

export const EMPTY_PROFILE: Profile = { about: '', stack: '', goals: '', preferences: '' }

export function getProfile(db: Db): Profile {
  const parsed = Profile.safeParse(read(db, 'profile'))
  return parsed.success ? parsed.data : EMPTY_PROFILE
}

const PROFILE_LABELS: Record<keyof Profile, string> = {
  about: 'About me',
  stack: 'Tools and stack I use',
  goals: 'What I am working towards',
  preferences: 'How I like to learn',
}

/** The profile as text for a system prompt, or null when it is empty. */
export function profileText(db: Db): string | null {
  const profile = getProfile(db)
  const parts = (Object.keys(PROFILE_LABELS) as (keyof Profile)[])
    .filter((k) => profile[k].trim())
    .map((k) => `${PROFILE_LABELS[k]}:\n${profile[k].trim()}`)
  return parts.length ? parts.join('\n\n') : null
}

export function getSettings(db: Db): SettingsView {
  return {
    model: currentModel(db),
    defaultModel: config.model,
    models: [...new Set<string>([...MODELS, config.model])],
    profile: getProfile(db),
  }
}

export function updateSettings(db: Db, input: z.infer<typeof UpdateSettingsInput>): SettingsView {
  tx(db, () => {
    if (input.model) write(db, 'model', input.model satisfies Model)
    if (input.profile) write(db, 'profile', { ...getProfile(db), ...input.profile })
  })
  return getSettings(db)
}
