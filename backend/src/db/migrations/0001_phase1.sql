-- Phase 1: learning map. Mirrors docs/data-model.md (Physical model, DDL — Phase 1).
-- Later phases add tables in new migration files; this file must not change once applied.

CREATE TABLE areas (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  summary      TEXT,
  position     INTEGER NOT NULL DEFAULT 0,
  archived_at  TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_areas_name_live ON areas (lower(name)) WHERE archived_at IS NULL;

CREATE TABLE topics (
  id                    TEXT PRIMARY KEY,
  title                 TEXT NOT NULL,
  summary               TEXT,
  why_i_care            TEXT,
  area_id               TEXT REFERENCES areas (id),
  status_override       TEXT,
  status_override_note  TEXT,
  status_override_at    TEXT,
  merged_into_id        TEXT REFERENCES topics (id),
  archived_at           TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  CHECK ((status_override IS NULL) = (status_override_at IS NULL)),
  CHECK (merged_into_id IS NULL OR (merged_into_id <> id AND archived_at IS NOT NULL))
);
CREATE UNIQUE INDEX ux_topics_title_live ON topics (lower(title)) WHERE archived_at IS NULL;
CREATE INDEX ix_topics_area ON topics (area_id) WHERE archived_at IS NULL;

CREATE TABLE ai_runs (
  id             TEXT PRIMARY KEY,
  task           TEXT NOT NULL,
  prompt_name    TEXT NOT NULL,                 -- file under prompts/
  prompt_hash    TEXT NOT NULL,                 -- sha256 of the prompt text actually sent
  model          TEXT NOT NULL,
  request_json   TEXT NOT NULL CHECK (json_valid(request_json)),
  attempts_json  TEXT NOT NULL CHECK (json_valid(attempts_json)),  -- [{raw_output, validation_error}]
  result_json    TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  outcome        TEXT NOT NULL,
  attempt_count  INTEGER NOT NULL CHECK (attempt_count >= 1),
  input_tokens   INTEGER,
  output_tokens  INTEGER,
  latency_ms     INTEGER,
  created_at     TEXT NOT NULL
);
CREATE INDEX ix_ai_runs_task ON ai_runs (task, created_at);

CREATE TABLE proposals (
  id                 TEXT PRIMARY KEY,
  ai_run_id          TEXT REFERENCES ai_runs (id),     -- NULL if user-originated
  kind               TEXT NOT NULL,
  target_type        TEXT,
  target_id          TEXT,                             -- loose reference, NULL for creates
  area_id            TEXT REFERENCES areas (id),
  topic_id           TEXT REFERENCES topics (id),
  payload_json       TEXT NOT NULL CHECK (json_valid(payload_json)),
  payload_version    INTEGER NOT NULL DEFAULT 1,
  rationale          TEXT,
  depends_on_id      TEXT REFERENCES proposals (id),
  status             TEXT NOT NULL DEFAULT 'pending',
  decided_at         TEXT,
  decision_note      TEXT,
  applied_entity_id  TEXT,
  created_at         TEXT NOT NULL,
  CHECK ((status = 'pending') = (decided_at IS NULL))
);
CREATE INDEX ix_proposals_status_area  ON proposals (status, area_id);
CREATE INDEX ix_proposals_status_topic ON proposals (status, topic_id);
CREATE INDEX ix_proposals_run          ON proposals (ai_run_id);

CREATE TABLE topic_events (
  id           TEXT PRIMARY KEY,
  topic_id     TEXT NOT NULL REFERENCES topics (id),
  event_type   TEXT NOT NULL,
  from_value   TEXT,
  to_value     TEXT,
  actor        TEXT NOT NULL,
  proposal_id  TEXT REFERENCES proposals (id),
  created_at   TEXT NOT NULL
);
CREATE INDEX ix_topic_events_topic ON topic_events (topic_id, created_at);

CREATE TABLE topic_links (
  id                  TEXT PRIMARY KEY,
  from_topic_id       TEXT NOT NULL REFERENCES topics (id),
  to_topic_id         TEXT NOT NULL REFERENCES topics (id),
  link_type           TEXT NOT NULL,
  rationale           TEXT,
  source_proposal_id  TEXT REFERENCES proposals (id),
  created_at          TEXT NOT NULL,
  CHECK (from_topic_id <> to_topic_id),
  CHECK (link_type <> 'related_to' OR from_topic_id < to_topic_id),
  UNIQUE (from_topic_id, to_topic_id, link_type)
);
CREATE INDEX ix_topic_links_to ON topic_links (to_topic_id, link_type);
CREATE UNIQUE INDEX ux_topic_links_one_parent ON topic_links (from_topic_id) WHERE link_type = 'part_of';

CREATE TABLE goals (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  description  TEXT,
  target_date  TEXT,
  status       TEXT NOT NULL DEFAULT 'active',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE topic_goals (
  topic_id    TEXT NOT NULL REFERENCES topics (id) ON DELETE CASCADE,
  goal_id     TEXT NOT NULL REFERENCES goals (id)  ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (topic_id, goal_id)
);
CREATE INDEX ix_topic_goals_goal ON topic_goals (goal_id);

CREATE TABLE resources (
  id           TEXT PRIMARY KEY,
  topic_id     TEXT NOT NULL REFERENCES topics (id),
  kind         TEXT NOT NULL,
  title        TEXT NOT NULL,
  url          TEXT,
  note         TEXT,
  archived_at  TEXT,
  created_at   TEXT NOT NULL,
  CHECK (url IS NOT NULL OR note IS NOT NULL)
);
CREATE INDEX ix_resources_topic ON resources (topic_id);

CREATE TABLE ai_text_cache (
  id          TEXT PRIMARY KEY,
  purpose     TEXT NOT NULL,
  subject_id  TEXT NOT NULL,
  input_hash  TEXT NOT NULL,
  text        TEXT NOT NULL,
  ai_run_id   TEXT REFERENCES ai_runs (id),
  created_at  TEXT NOT NULL,
  UNIQUE (purpose, subject_id, input_hash)
);
