import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { config } from '../src/config'
import { openDb } from '../src/db/connection'
import { currentModel, profileText } from '../src/services/settings'

describe('settings', () => {
  it('switches the model and stores the profile sent to Claude', async () => {
    const db = openDb(':memory:')
    const app = createApp(db, { aiAvailable: () => false })
    expect(currentModel(db)).toBe(config.model)
    expect(profileText(db)).toBeNull()

    const patch = (body: unknown) =>
      app.request('/api/settings', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    expect((await patch({ model: 'claude-sonnet-5-5' })).status).toBe(200)
    expect(currentModel(db)).toBe('claude-sonnet-5-5')
    expect((await patch({ model: 'gpt-x' })).status).toBe(400)

    await patch({ profile: { stack: 'BigQuery, dbt, Postgres' } })
    await patch({ profile: { about: 'Data engineer in marketing analytics' } })
    expect(profileText(db)).toBe('About me:\nData engineer in marketing analytics\n\nTools and stack I use:\nBigQuery, dbt, Postgres')
    const home = await (await app.request('/api/home')).json()
    expect(home.model).toBe('claude-sonnet-5-5')
  })
})
