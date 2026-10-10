// Proposal payloads. A payload is stored as JSON with payload_version, so a later version
// can be added without breaking rows written by an earlier one.
// v2: create_topic gains an optional parent_topic_id (the new topic becomes its sub-topic).
//     lesson_patch is added: block operations on one lesson version.
import { z } from 'zod'
import { LINK_TYPES, type ProposalKind } from './domain'
import { Block } from './lessons'

export const PAYLOAD_VERSION = 2

const id = z.string().min(1)
const nullableText = z.string().nullable()

/**
 * One change to a lesson. A replaced question that keeps its block id keeps its review
 * schedule; a new id starts a new schedule (data-model rule 8).
 */
export const LessonPatchOp = z.discriminatedUnion('op', [
  z.object({ op: z.literal('replace'), block_id: id, block: Block }),
  z.object({ op: z.literal('add'), after_block_id: id.nullable(), block: Block }),
  z.object({ op: z.literal('remove'), block_id: id }),
  z.object({ op: z.literal('move'), block_id: id, after_block_id: id.nullable() }),
])
export type LessonPatchOp = z.infer<typeof LessonPatchOp>

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
  lesson_patch: z.object({
    lesson_id: id,
    /** The version the operations apply to. Accepting fails if the lesson has moved on. */
    base_version_id: id,
    change_note: z.string(),
    ops: z.array(LessonPatchOp).min(1),
  }),
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
