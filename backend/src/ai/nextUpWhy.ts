// Writes the short "why this next" line for the top Next up items, and caches it.
import { z } from 'zod'
import type { Db } from '../db/connection'
import { NEXT_UP_EXPLAINED, rankNextUp, storeWhy } from '../services/nextUp'
import { getTopic } from '../services/topics'
import { callStructured } from './client'

const WhyOutput = z.object({
  items: z.array(z.object({ topic_id: z.string(), why: z.string().min(1).max(240) })),
})

/** Generates missing explanations for the top items. Returns how many were written. */
export async function explainNextUp(db: Db): Promise<number> {
  const missing = rankNextUp(db)
    .slice(0, NEXT_UP_EXPLAINED)
    .filter((i) => !i.why)
  if (!missing.length) return 0
  const ids = new Set(missing.map((i) => i.topic_id))
  const { runId, result } = await callStructured(db, {
    task: 'next_up_why',
    promptName: 'next_up_why',
    schema: WhyOutput,
    input: {
      items: missing.map((i) => {
        const topic = getTopic(db, i.topic_id)
        return {
          topic_id: i.topic_id,
          title: i.title,
          area: i.areaName,
          summary: topic?.summary ?? null,
          why_i_care: topic?.why_i_care ?? null,
          factors: i.factors,
        }
      }),
    },
    check: (out) => {
      const returned = new Set(out.items.map((i) => i.topic_id))
      const problems = out.items.filter((i) => !ids.has(i.topic_id)).map((i) => `unknown topic_id "${i.topic_id}"`)
      for (const id of ids) if (!returned.has(id)) problems.push(`missing an item for topic_id "${id}"`)
      return problems
    },
    effort: 'low',
  })
  for (const item of missing) {
    const why = result.items.find((i) => i.topic_id === item.topic_id)
    if (why) storeWhy(db, item, why.why, runId)
  }
  return missing.length
}
