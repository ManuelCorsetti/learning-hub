-- Phase 2.5: app settings (model choice, learner profile) and the conversations behind Build lesson.
-- Mirrors docs/data-model.md (DDL — Phase 2.5). This file must not change once applied.

CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value_json  TEXT NOT NULL CHECK (json_valid(value_json)),
  updated_at  TEXT NOT NULL
);

CREATE TABLE lesson_requests (
  id             TEXT PRIMARY KEY,
  topic_id       TEXT NOT NULL REFERENCES topics (id),
  level          TEXT,
  brief          TEXT,
  messages_json  TEXT NOT NULL CHECK (json_valid(messages_json)),          -- [{role, content}]
  plan_json      TEXT CHECK (plan_json IS NULL OR json_valid(plan_json)),  -- latest plan from the planner
  status         TEXT NOT NULL,
  lesson_id      TEXT REFERENCES lessons (id),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX ix_lesson_requests_topic ON lesson_requests (topic_id, created_at);
