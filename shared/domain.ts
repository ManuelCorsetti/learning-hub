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

export const LESSON_ORIGINS = ['ai', 'user', 'imported_article'] as const
export type LessonOrigin = (typeof LESSON_ORIGINS)[number]

export const LESSON_AUTHORS = ['ai', 'user'] as const
export type LessonAuthor = (typeof LESSON_AUTHORS)[number]

export const TEACHING_BLOCK_TYPES = ['concept', 'steps', 'diagram'] as const
export const INTERACTIVE_BLOCK_TYPES = [
  'quiz_mcq',
  'quiz_true_false',
  'fill_in_blank',
  'code_challenge',
  'ordering',
  'project_prompt',
] as const
export const BLOCK_TYPES = [...TEACHING_BLOCK_TYPES, ...INTERACTIVE_BLOCK_TYPES] as const
export type TeachingBlockType = (typeof TEACHING_BLOCK_TYPES)[number]
export type InteractiveBlockType = (typeof INTERACTIVE_BLOCK_TYPES)[number]
export type BlockType = (typeof BLOCK_TYPES)[number]

/** Diagram blocks can only use a key that has a React component in the frontend registry. */
export const DIAGRAM_KEYS = ['star', 'schema', 'hierarchy', 'conformed', 'marketing'] as const
export type DiagramKey = (typeof DIAGRAM_KEYS)[number]

export const STUDY_SESSION_KINDS = ['lesson', 'review', 'placement'] as const
export type StudySessionKind = (typeof STUDY_SESSION_KINDS)[number]

/** 1 guessing · 2 fairly sure · 3 certain */
export const CONFIDENCES = [1, 2, 3] as const
export type Confidence = (typeof CONFIDENCES)[number]
export const CONFIDENCE_LABELS: Record<Confidence, string> = { 1: 'Guessing', 2: 'Fairly sure', 3: 'Certain' }

/** 1 Again · 2 Hard · 3 Good · 4 Easy */
export type Rating = 1 | 2 | 3 | 4
export const RATING_LABELS: Record<Rating, string> = { 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' }

export const REVIEW_STATES = ['new', 'learning', 'review', 'relearning'] as const
export type ReviewState = (typeof REVIEW_STATES)[number]

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
