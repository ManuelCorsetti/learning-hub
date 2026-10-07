// Enumerations and rules shared by the API and the UI.
// Enumerations are validated here, not by database CHECK constraints (see docs/data-model.md).

export const TOPIC_STATUSES = ['backlog', 'learning', 'solid'] as const
export type TopicStatus = (typeof TOPIC_STATUSES)[number]

export const LINK_TYPES = ['prerequisite_of', 'related_to', 'part_of'] as const
export type LinkType = (typeof LINK_TYPES)[number]

export const GOAL_STATUSES = ['active', 'achieved', 'dropped'] as const
export type GoalStatus = (typeof GOAL_STATUSES)[number]

export const RESOURCE_KINDS = ['link', 'book', 'video', 'course', 'note'] as const
export type ResourceKind = (typeof RESOURCE_KINDS)[number]

export const TOPIC_EVENT_TYPES = [
  'created',
  'renamed',
  'area_changed',
  'status_override_set',
  'status_override_cleared',
  'status_override_resolved',
  'merged',
  'archived',
  'restored',
] as const
export type TopicEventType = (typeof TOPIC_EVENT_TYPES)[number]

export const ACTORS = ['user', 'system', 'proposal'] as const
export type Actor = (typeof ACTORS)[number]

export const PROPOSAL_KINDS = [
  'create_area',
  'update_area',
  'create_topic',
  'update_topic',
  'move_topic',
  'merge_topics',
  'archive_topic',
  'create_link',
  'remove_link',
] as const
export type ProposalKind = (typeof PROPOSAL_KINDS)[number]

export const PROPOSAL_STATUSES = ['pending', 'accepted', 'rejected', 'superseded', 'failed'] as const
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number]

export const AI_TASKS = ['capture', 'organise', 'next_up_why', 'generate_lesson', 'lesson_patch', 'optimise'] as const
export type AiTask = (typeof AI_TASKS)[number]

/** Mastery (coverage × retention) at or above this, with every item tested, counts as solid. */
export const SOLID_MASTERY_THRESHOLD = 0.8

export const LINK_TYPE_LABELS: Record<LinkType, string> = {
  prerequisite_of: 'prerequisite of',
  related_to: 'related to',
  part_of: 'part of',
}

export const STATUS_LABELS: Record<TopicStatus, string> = {
  backlog: 'Backlog',
  learning: 'Learning',
  solid: 'Solid',
}
