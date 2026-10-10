import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { openDb } from '../src/db/connection'

const create = vi.fn()
vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@anthropic-ai/sdk')>()
  const Real = mod.default
  class Fake extends Real {
    constructor() {
      super({ apiKey: 'test' })
      Object.defineProperty(this, 'beta', { value: { messages: { create } } })
    }
  }
  return { ...mod, default: Fake }
})
const { callStructured, supportsServerFallback } = await import('../src/ai/client')

const reply = (text: string) => ({
  content: [{ type: 'text', text }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 1, output_tokens: 1 },
})
const schema = z.object({ ok: z.boolean() })

describe('request parameters by model', () => {
  beforeEach(() => create.mockReset().mockResolvedValue(reply('{"ok":true}')))

  it('sends no fallback parameters to Haiku, and the requested model and effort', async () => {
    await callStructured(openDb(':memory:'), { task: 'grade_answer', promptName: 'answer_grader', schema, input: {}, model: 'claude-haiku-5-5', effort: 'low', profile: false })
    const params = create.mock.calls[0][0]
    expect(params).toMatchObject({ model: 'claude-haiku-5-5', output_config: { effort: 'low' } })
    expect(params).not.toHaveProperty('betas')
    expect(params).not.toHaveProperty('fallbacks')
    expect(params).not.toHaveProperty('temperature')
    expect(params.system).toHaveLength(1)
  })

  it('keeps the server-side fallback for the Settings model', async () => {
    const db = openDb(':memory:')
    await callStructured(db, { task: 'capture', promptName: 'capture', schema, input: {} })
    expect(create.mock.calls[0][0]).toMatchObject({ betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
    expect(supportsServerFallback('claude-sonnet-5-5')).toBe(true)
    expect(supportsServerFallback('claude-haiku-5-5')).toBe(false)
  })
})
