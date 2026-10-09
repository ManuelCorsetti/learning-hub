-- Phase 2: lessons, attempts and spaced repetition. Mirrors docs/data-model.md (DDL — Phase 2).
-- This file must not change once applied.

CREATE TABLE lessons (
  id           TEXT PRIMARY KEY,
  topic_id     TEXT NOT NULL REFERENCES topics (id),
  title        TEXT NOT NULL,
  origin       TEXT NOT NULL,
  archived_at  TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX ix_lessons_topic ON lessons (topic_id);

CREATE TABLE lesson_versions (
  id                   TEXT PRIMARY KEY,
  lesson_id            TEXT NOT NULL REFERENCES lessons (id),
  version_no           INTEGER NOT NULL CHECK (version_no >= 1),
  schema_version       INTEGER NOT NULL,
  blocks_json          TEXT NOT NULL CHECK (json_valid(blocks_json)),
  created_by           TEXT NOT NULL,
  change_note          TEXT,
  based_on_version_id  TEXT REFERENCES lesson_versions (id),
  source_proposal_id   TEXT REFERENCES proposals (id),
  ai_run_id            TEXT REFERENCES ai_runs (id),
  created_at           TEXT NOT NULL,
  UNIQUE (lesson_id, version_no)
);

CREATE TABLE review_items (
  id                TEXT PRIMARY KEY,
  lesson_id         TEXT NOT NULL REFERENCES lessons (id),
  block_id          TEXT NOT NULL,
  block_type        TEXT NOT NULL,
  is_scheduled      INTEGER NOT NULL CHECK (is_scheduled IN (0, 1)),
  first_version_id  TEXT NOT NULL REFERENCES lesson_versions (id),
  retired_at        TEXT,
  created_at        TEXT NOT NULL,
  UNIQUE (lesson_id, block_id)
);

CREATE TABLE study_sessions (
  id                 TEXT PRIMARY KEY,
  kind               TEXT NOT NULL,
  lesson_version_id  TEXT REFERENCES lesson_versions (id),
  started_at         TEXT NOT NULL,
  completed_at       TEXT
);

CREATE TABLE attempts (
  id                 TEXT PRIMARY KEY,
  review_item_id     TEXT NOT NULL REFERENCES review_items (id),
  session_id         TEXT NOT NULL REFERENCES study_sessions (id),
  lesson_version_id  TEXT NOT NULL REFERENCES lesson_versions (id),
  answer_json        TEXT NOT NULL CHECK (json_valid(answer_json)),
  is_correct         INTEGER CHECK (is_correct IN (0, 1)),          -- NULL = not auto-gradable
  score              REAL    CHECK (score BETWEEN 0 AND 1),
  confidence         INTEGER CHECK (confidence BETWEEN 1 AND 3),
  rating             INTEGER CHECK (rating BETWEEN 1 AND 4),        -- NULL = not scheduled
  duration_ms        INTEGER,
  answered_at        TEXT NOT NULL
);
CREATE INDEX ix_attempts_item    ON attempts (review_item_id, answered_at);
CREATE INDEX ix_attempts_session ON attempts (session_id);

CREATE TABLE review_item_state (
  review_item_id     TEXT PRIMARY KEY REFERENCES review_items (id),
  scheduler          TEXT NOT NULL,     -- 'fsrs'
  scheduler_version  TEXT NOT NULL,     -- library version + parameter-set hash
  state              TEXT NOT NULL,
  stability          REAL,
  difficulty         REAL,
  due_at             TEXT NOT NULL,
  last_reviewed_at   TEXT,
  reps               INTEGER NOT NULL DEFAULT 0,
  lapses             INTEGER NOT NULL DEFAULT 0,
  computed_at        TEXT NOT NULL
);
CREATE INDEX ix_review_item_state_due ON review_item_state (due_at);
