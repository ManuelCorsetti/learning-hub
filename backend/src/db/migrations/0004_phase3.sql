-- Phase 3: co-author threads on lessons, and personal scheduler parameters.
-- Mirrors docs/data-model.md (DDL — Phase 3). This file must not change once applied.

CREATE TABLE chat_threads (
  id           TEXT PRIMARY KEY,
  lesson_id    TEXT NOT NULL REFERENCES lessons (id),
  title        TEXT,
  archived_at  TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX ix_chat_threads_lesson ON chat_threads (lesson_id);

CREATE TABLE chat_messages (
  id           TEXT PRIMARY KEY,
  thread_id    TEXT NOT NULL REFERENCES chat_threads (id),
  role         TEXT NOT NULL,
  content      TEXT NOT NULL,
  block_id     TEXT,                              -- the block a note is about, if any
  proposal_id  TEXT REFERENCES proposals (id),
  ai_run_id    TEXT REFERENCES ai_runs (id),
  created_at   TEXT NOT NULL
);
CREATE INDEX ix_chat_messages_thread ON chat_messages (thread_id, created_at);

CREATE TABLE scheduler_params (
  id                   TEXT PRIMARY KEY,
  scheduler            TEXT NOT NULL,
  params_json          TEXT NOT NULL CHECK (json_valid(params_json)),
  trained_on_attempts  INTEGER NOT NULL,
  is_active            INTEGER NOT NULL CHECK (is_active IN (0, 1)),
  created_at           TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_scheduler_params_active ON scheduler_params (scheduler) WHERE is_active = 1;
