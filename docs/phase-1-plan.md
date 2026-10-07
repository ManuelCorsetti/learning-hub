# Learning Studio — Phase 1 Plan: the learning map

Replaces the Phase 1 part of `claude-files-for-analysis/learning-tool-mvp-plan.md`.
Phases 2 and 3 are in [phase-2-3-plan.md](phase-2-3-plan.md). The data model
for all phases is in [data-model.md](data-model.md).

## What this is

Learning Studio becomes a personal **learning map**: a tracker of everything
you want to learn, where AI helps capture, group and order topics. Lessons and
testing come in Phase 2. Phase 1 is useful on its own.

## Decisions taken

| Topic | Decision |
|-------|----------|
| Product identity | Keep the **Learning Studio** name and its **light** look: paper background, DM Sans / Playfair / DM Mono, the tokens in `src/styles.css`. The "1 · Map" mockup is used for **layout and content only** (capture box, Next up, area cards). Its dark palette is not used. |
| Naming | **Areas** everywhere: table, API, UI. Not "clusters" or "categories". |
| Status | **Measured, not typed in.** Mastery comes from tests plus spaced repetition (Phase 2). The user can override the *status*, never the *metric*. See [data-model.md → How status works](data-model.md#how-status-works). |
| Existing articles | Become **backlog topics** (lesson ideas). The dimensional-modelling content is kept as seed data for the first lesson in Phase 2. Start small. |
| Missing screens | The Area and Review screens have no design yet. Build them plainly in Phase 1 and design them later. |

## Stack

**Decided: TypeScript end to end** on Node 22+. One language, one `npm` toolchain,
and schemas shared between the API and the UI (`shared/`).

| Concern | Choice | Notes |
|---|---|---|
| Database | Built-in `node:sqlite` | No native build step (better-sqlite3 had no prebuilt binary for this Node/Windows combination). Node flags it experimental, so the scripts hide that warning. |
| Migrations | Numbered SQL files in `backend/src/db/migrations/` | Applied automatically on start and tracked in `schema_migrations`. The SQL mirrors `docs/data-model.md` exactly (partial unique indexes, CHECKs), which an ORM schema would not. Moving to Postgres means porting these files. |
| HTTP | Hono + `@hono/node-server` | `backend/src/app.ts` |
| Validation | Zod 4 | API input and every Claude response |
| AI | `@anthropic-ai/sdk`, `claude-opus-5-5` | Structured outputs from the Zod schemas; server-side refusal fallback enabled; model overridable with `LEARNING_MODEL` |
| UI | React 19 + Vite, React Flow + dagre | Learning Studio light styles |
| Tests | Vitest | `backend/test/` |
| Spaced repetition (Phase 2) | `ts-fsrs` | |

You can still analyse your learning data in Python or notebooks: it's one SQLite
file (`data/learning-studio.db`).

Also:
- **Single local user**, no auth.
- **No graph database or embeddings.** A few hundred topics fit in plain tables.
- **Every dependency is pinned** in `package.json`.

## Rules for every phase

1. **AI proposes, you decide.** The AI only writes `proposals`. Nothing changes
   until you accept.
2. **AI generates data, never code.** It fills JSON for fixed, pre-built
   components.
3. **One shared AI call pattern.**
   - Flow: prompt → JSON → schema validation.
   - On failure, retry once with the validation error appended.
   - On a second failure, return a clear error. Never guess or silently repair.
   - Every call, successful or not, is logged in `ai_runs`.
4. **Prompts live in their own files** under `prompts/`. `ai_runs.prompt_hash`
   records which version of the prompt produced each result.
5. **Metrics are measured.** Nothing stores a hand-entered progress %.
6. **Archive, don't delete.** Write a `topic_events` row for every topic change.

## Repo layout

```
learning-hub/
  frontend/          React app (src/pages, src/components)
  backend/           API (src/app.ts), services, AI flows (src/ai), migrations, scripts, tests
  shared/            enumerations, API types and proposal payload schemas used by both sides
  prompts/           capture.txt, organise.txt, next_up_why.txt
  seed/              areas+topics seed, articles/dimensional-modelling.json
  docs/              these plans
```

## Data (Phase 1 tables)

`areas`, `topics`, `topic_links`, `topic_events`, `goals`, `topic_goals`,
`resources`, `ai_runs`, `proposals`, `ai_text_cache`. The full definitions and
DDL are in [data-model.md](data-model.md).

What this means for status in Phase 1:
- There are no tests yet, so the derived status of every topic is `backlog`.
- The status control on a topic sets `status_override`, e.g. *learning*, or
  *solid (self-assessed)*.
- The UI labels these as overrides. The mastery figure shows *not measured*.

### Seed data (small on purpose)

| Area (position) | Topics (all `backlog`) |
|-----------------|------------------------|
| 01 Data engineering | Dimensional modelling · Change data capture |
| 02 Machine learning | Reinforcement learning for marketing |
| 03 Cloud & platform | Cloud networking fundamentals |

- Take titles, summaries and tags from the current `articles` array in
  `src/main.jsx`. Tags become words in the summary, not a separate table.
- Export the dimensional-modelling sections (body, steps, callouts, visuals) to
  `seed/articles/dimensional-modelling.json`. It will be imported as the first
  lesson in Phase 2.
- The larger backlog from the original plan is **not** seeded. It becomes the
  sample brain-dump for testing Capture (step 4 and step 6):
  - Python CLI tools, ABCs/interfaces
  - Go vs Rust
  - dbt incremental models, macros, testing
  - Kimball, Data Vault, Medallion
  - tool use, structured outputs, evals, sandboxed execution

## Features

1. **Capture**: one text box ("What do you want to get good at?").
   - Paste a messy brain-dump.
   - Claude extracts candidate topics, removes duplicates against existing
     topics, and suggests an area for each.
   - The result is a set of `create_topic` proposals from one `ai_run`, which
     you can batch-accept.
2. **Organise**: a button that asks Claude to suggest *changes*:
   - new or renamed areas, moving topics between areas, merges;
   - `prerequisite_of`, `related_to` and `part_of` links.
   
   Each suggestion has a one-line rationale. Accept or reject each one, or
   batch-accept. The organise prompt receives the current areas and links so it
   suggests changes rather than a rebuild.
3. **Home (Studio light)**, with the mockup's layout:
   - capture box at the top;
   - Next up (3 cards: area, title, why);
   - area cards: position number, topic count, summary, a solid / learning /
     backlog bar by effective status, topic chips, and "N suggestions to review";
   - "+ New area" (manual create, no AI).
4. **Area page**: list of topics plus a graph view (React Flow).
   - Node colour = effective status.
   - Goals appear as special nodes.
   - Click a node for a side panel: summary, why I care, links, resources,
     goals, status override, history from `topic_events`.
5. **Review screen**: all pending proposals, grouped by AI run, with accept /
   reject / batch accept.
6. **Next up**: a ranked list.
   - Score is deterministic code: prerequisites already solid (effective
     status) + leverage (number of dependants) + linked to an active goal +
     manual *learning* override.
   - Exclude topics that are solid or archived.
   - Claude writes the short "why this next" text for the top 3 only.
   - That text is cached in `ai_text_cache` by a hash of the inputs, so it is
     regenerated only when the inputs change.

## Build order

Steps 1–9 are implemented. Steps 6 and 7 still need your review: run Capture and
Organise on your real notes and tune the prompts.


1. **Restructure and scaffold.**
   - Move the current app into `frontend/`.
   - Add `backend/` with a health check and confirm the two talk locally.
   - Pin dependency versions.
   - Add a `dev` script that runs both.
2. **Database.**
   - Migration tool set up, with the Phase 1 tables from `data-model.md`.
   - Connection PRAGMAs (`foreign_keys`, `WAL`).
   - Seed script for areas and topics.
   - Export `seed/articles/dimensional-modelling.json`.
3. **Areas and topics CRUD, plus the home page.**
   - Manual create, edit, archive and move.
   - Status override control.
   - Every change writes `topic_events`.
   - Re-skin the mockup layout with the Studio styles.
   - No AI yet.
4. **AI call helper.**
   - The shared prompt → validate → retry-once pattern, with `ai_runs` logging.
   - A standalone script that runs it on the sample brain-dump.
5. **Proposals system.**
   - Create, list, accept and reject endpoints; batch accept by run.
   - Dependency ordering, and applying changes in a transaction.
   - A plain review screen.
6. **Capture flow.** **Stop for review** and tune `prompts/capture.txt`.
7. **Organise flow.** **Stop for review** and tune `prompts/organise.txt`.
8. **Area page and graph view.** Read-only first, then the side-panel actions.
9. **Next up**, with the explanation cache.

## Phase 1 non-goals

- No lessons, quizzes or widgets. That is Phase 2, where mastery becomes real.
- No hand-entered progress or mastery numbers.
- No embeddings, no graph database, no auto-applied AI changes.
- No final design for the Area and Review screens.
