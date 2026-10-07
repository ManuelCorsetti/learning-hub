// Request schemas (validated on the server) and response shapes (used by the UI).
import { z } from 'zod'
import {
  GOAL_STATUSES,
  LINK_TYPES,
  RESOURCE_KINDS,
  TOPIC_STATUSES,
  type Actor,
  type GoalStatus,
  type LinkType,
  type ProposalKind,
  type ProposalStatus,
  type ResourceKind,
  type TopicEventType,
  type TopicStatus,
} from './domain'

const text = z.string().trim()
const optionalText = text.nullable().optional()

// ---------- Requests ----------

export const CreateAreaInput = z.object({
  name: text.min(1).max(80),
  summary: optionalText,
})
export const UpdateAreaInput = z.object({
  name: text.min(1).max(80).optional(),
  summary: optionalText,
  position: z.number().int().min(0).optional(),
})

export const CreateTopicInput = z.object({
  title: text.min(1).max(120),
  summary: optionalText,
  why_i_care: optionalText,
  area_id: z.string().nullable().optional(),
})
export const UpdateTopicInput = z.object({
  title: text.min(1).max(120).optional(),
  summary: optionalText,
  why_i_care: optionalText,
  area_id: z.string().nullable().optional(),
})
export const SetStatusInput = z.object({
  status: z.enum(TOPIC_STATUSES),
  note: optionalText,
})
export const MergeTopicInput = z.object({ merge_topic_id: z.string() })

export const CreateLinkInput = z.object({
  from_topic_id: z.string(),
  to_topic_id: z.string(),
  link_type: z.enum(LINK_TYPES),
  rationale: optionalText,
})

export const CreateGoalInput = z.object({
  title: text.min(1).max(160),
  description: optionalText,
  target_date: z.iso.date().nullable().optional(),
})
export const UpdateGoalInput = z.object({
  title: text.min(1).max(160).optional(),
  description: optionalText,
  target_date: z.iso.date().nullable().optional(),
  status: z.enum(GOAL_STATUSES).optional(),
})
export const LinkGoalInput = z.object({ goal_id: z.string() })

export const CreateResourceInput = z
  .object({
    kind: z.enum(RESOURCE_KINDS),
    title: text.min(1).max(200),
    url: text.url().nullable().optional(),
    note: optionalText,
  })
  .refine((r) => r.url || r.note, { message: 'A resource needs a URL or a note' })

export const CaptureInput = z.object({ text: text.min(3).max(20000) })
export const AcceptManyInput = z.object({ ids: z.array(z.string()).min(1) })

// ---------- Responses ----------

export interface Measurement {
  /** 0–1, or null when the topic has nothing to test yet ("not measured"). */
  mastery: number | null
  coverage: number | null
  retention: number | null
  derived: TopicStatus
  reviewsDue: number
}

export interface TopicStatusInfo {
  effective: TopicStatus
  derived: TopicStatus
  override: TopicStatus | null
  overrideNote: string | null
  mastery: number | null
}

export interface TopicListItem {
  id: string
  title: string
  summary: string | null
  area_id: string | null
  status: TopicStatusInfo
  created_at: string
}

export interface AreaSummary {
  id: string
  name: string
  summary: string | null
  position: number
  counts: Record<TopicStatus, number>
  topicCount: number
  chips: string[]
  pendingProposals: number
  mastery: number | null
}

export interface HomeData {
  areas: AreaSummary[]
  inboxCount: number
  topicCount: number
  pendingProposals: number
  aiAvailable: boolean
}

export interface LinkView {
  id: string
  from_topic_id: string
  to_topic_id: string
  link_type: LinkType
  rationale: string | null
  other: { id: string; title: string; area_id: string | null }
  direction: 'out' | 'in'
}

export interface GoalView {
  id: string
  title: string
  description: string | null
  target_date: string | null
  status: GoalStatus
  topics: { id: string; title: string }[]
}

export interface ResourceView {
  id: string
  kind: ResourceKind
  title: string
  url: string | null
  note: string | null
  created_at: string
}

export interface TopicEventView {
  id: string
  event_type: TopicEventType
  from_value: string | null
  to_value: string | null
  actor: Actor
  created_at: string
}

export interface TopicDetail extends TopicListItem {
  why_i_care: string | null
  area: { id: string; name: string } | null
  archived_at: string | null
  merged_into_id: string | null
  links: LinkView[]
  goals: { id: string; title: string; status: GoalStatus }[]
  resources: ResourceView[]
  events: TopicEventView[]
}

export interface AreaDetail {
  area: { id: string; name: string; summary: string | null; position: number } | null
  topics: TopicListItem[]
}

export interface GraphNode {
  id: string
  kind: 'topic' | 'goal'
  label: string
  status: TopicStatus | null
  external: boolean
  areaName: string | null
}
export interface GraphEdge {
  id: string
  source: string
  target: string
  kind: LinkType | 'serves_goal'
}
export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export interface ProposalView {
  id: string
  kind: ProposalKind
  status: ProposalStatus
  description: string
  /** Extra context, e.g. the summary of a proposed topic. */
  detail: string | null
  rationale: string | null
  depends_on_id: string | null
  area_id: string | null
  decision_note: string | null
  created_at: string
  decided_at: string | null
}

export interface ProposalGroup {
  ai_run_id: string | null
  task: string | null
  created_at: string
  proposals: ProposalView[]
}

export interface NextUpItem {
  topic_id: string
  title: string
  area_id: string | null
  areaName: string | null
  score: number
  factors: {
    prereqs: string[]
    prereqReady: number
    unmetPrereqs: string[]
    unlocks: string[]
    goals: string[]
    learning: boolean
  }
  why: string | null
  fallbackWhy: string
}

export interface AcceptResult {
  id: string
  status: ProposalStatus
  decision_note: string | null
}
