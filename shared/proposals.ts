// Proposal payloads. A payload is stored as JSON with payload_version, so a later version
// can be added without breaking rows written by an earlier one.
// v2: create_topic gains an optional parent_topic_id (the new topic becomes its sub-topic).
import { z } from 'zod'
import { LINK_TYPES, type ProposalKind } from './domain'

export const PAYLOAD_VERSION = 2

const id = z.string().min(1)
const nullableText = z.string().nullable()

export const ProposalPayloads = {
  create_area: z.object({ id, name: z.string().min(1), summary: nullableText }),
  update_area: z.object({ area_id: id, name: nullableText, summary: nullableText }),
  create_topic: z.object({
    id,
    title: z.string().min(1),
    summary: nullableText,
    why_i_care: nullableText,
    area_id: id.nullable(),
    parent_topic_id: id.nullable().optional(),
  }),
  update_topic: z.object({ topic_id: id, title: nullableText, summary: nullableText, why_i_care: nullableText }),
  move_topic: z.object({ topic_id: id, area_id: id.nullable() }),
  merge_topics: z.object({ keep_topic_id: id, merge_topic_id: id }),
  archive_topic: z.object({ topic_id: id }),
  create_link: z.object({ id, from_topic_id: id, to_topic_id: id, link_type: z.enum(LINK_TYPES) }),
  remove_link: z.object({ link_id: id }),
} satisfies Record<ProposalKind, z.ZodType>

export type ProposalPayload<K extends ProposalKind> = z.infer<(typeof ProposalPayloads)[K]>

export type ProposalDraft = {
  [K in ProposalKind]: {
    id: string
    kind: K
    payload: ProposalPayload<K>
    rationale: string | null
    depends_on_id?: string | null
  }
}[ProposalKind]
