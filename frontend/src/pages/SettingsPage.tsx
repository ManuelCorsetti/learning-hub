// Settings: which Claude model to use, and the profile Claude reads before every task.
import { useEffect, useState, type FormEvent } from 'react'
import type { Profile, SettingsView } from '../../../shared/api'
import { MODEL_LABELS, type Model } from '../../../shared/domain'
import { api, useAction, useApi } from '../api'

const FIELDS: { key: keyof Profile; label: string; hint: string }[] = [
  {
    key: 'about',
    label: 'About me',
    hint: 'Your role, background and what you already know well. e.g. "Data engineer in a marketing analytics team; strong SQL, some Python."',
  },
  {
    key: 'stack',
    label: 'Tools and stack',
    hint: 'What you work with day to day, so examples use it. e.g. "BigQuery, dbt, Postgres sources, Airflow, GCP."',
  },
  {
    key: 'goals',
    label: 'What I am working towards',
    hint: 'The bigger picture lessons should serve. e.g. "Own our CDC pipelines; write an internal article on AI for data engineering."',
  },
  {
    key: 'preferences',
    label: 'How I like to learn',
    hint: 'Depth, tone, examples. e.g. "Concrete examples from marketing data, short paragraphs, hard questions."',
  },
]

export const modelLabel = (model: string) => MODEL_LABELS[model as Model] ?? model

export function SettingsPage() {
  const { data, error } = useApi<SettingsView>('/settings')
  if (error) return <p className="error">{error}</p>
  if (!data) return <p className="muted">Loading…</p>
  return (
    <>
      <span className="eyebrow">Settings</span>
      <h1>
        How Claude <em>works</em> for you
      </h1>
      <p className="lede">
        Your profile goes with every Claude request: Capture, Organise, lesson planning and lesson writing. Claude uses
        it to pick examples, depth and vocabulary.
      </p>
      <ModelChoice settings={data} />
      <ProfileForm key={JSON.stringify(data.profile)} profile={data.profile} />
    </>
  )
}

function ModelChoice({ settings }: { settings: SettingsView }) {
  const { busy, error, run } = useAction()
  return (
    <section>
      <div className="section-head">
        <h2>Model</h2>
        <span>Used for every AI feature. Sonnet is faster and cheaper; Opus is more thorough.</span>
      </div>
      <div className="segmented" role="group" aria-label="Model">
        {settings.models.map((m) => (
          <button
            key={m}
            className={`learning ${settings.model === m ? 'on' : ''}`}
            disabled={busy}
            onClick={() => run(() => api.patch('/settings', { model: m }))}
          >
            {modelLabel(m)}
          </button>
        ))}
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>
        Default from the server: {modelLabel(settings.defaultModel)}. Every call records the model it used.
      </p>
      {error && <p className="error">{error}</p>}
    </section>
  )
}

function ProfileForm({ profile }: { profile: Profile }) {
  const [form, setForm] = useState(profile)
  const [saved, setSaved] = useState(false)
  const { busy, error, run } = useAction()
  const dirty = FIELDS.some((f) => form[f.key] !== profile[f.key])
  useEffect(() => {
    if (dirty) setSaved(false)
  }, [dirty])

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (await run(() => api.patch('/settings', { profile: form }))) setSaved(true)
  }
  return (
    <section>
      <div className="section-head">
        <h2>Your profile</h2>
        <span>Plain text. Write it the way you would brief a tutor.</span>
      </div>
      <form className="stack profile-form" onSubmit={save}>
        {FIELDS.map((f) => (
          <label key={f.key} className="field">
            <span>{f.label}</span>
            <textarea
              rows={3}
              value={form[f.key]}
              placeholder={f.hint}
              onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
            />
          </label>
        ))}
        <div className="row">
          <button className="btn primary" disabled={busy || !dirty}>
            Save profile
          </button>
          {saved && !dirty && <span className="small muted">Saved. Claude uses it from the next request.</span>}
        </div>
        {error && <p className="error">{error}</p>}
      </form>
    </section>
  )
}
