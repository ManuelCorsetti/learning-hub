# Learning Studio

Personal learning map: TypeScript end to end (Node 22+, Hono API, React + Vite UI, built-in `node:sqlite`).

## Read first

- `docs/phase-2-3-plan.md`: what to build next. It starts with a "Status and where to start" table.
- `docs/data-model.md`: the data model and the DDL for every phase.
- `docs/phase-1-plan.md`: what is already built, and the rules below in full.

## Commands

- `npm run dev`: API on :8787 (restarts on change) + Vite on :5173 (proxies `/api`)
- `npm test`: Vitest, in-memory database (`backend/test/`)
- `npm run typecheck`: run after every change
- `npm run ai:smoke`: one real Capture call against a throwaway database (costs money; needs `ANTHROPIC_API_KEY`)
- `npm run ai:lesson [-- "Topic" [--brief "…"] | -- --questions]`: one real lesson generation (with a planner turn when `--brief` is given), printed and saved under `data/lesson-samples/` (costs money)
- `npm run db:replay`: rebuild `review_item_state` from attempts
- `npm run ai:runs [-- <run id>]`: recent Claude calls from `ai_runs` (also in Settings → Recent Claude calls); the dev server prints one `[ai]` line per call
- Structured-output schemas: keep one union of block types per schema, never nested in another union (the API rejects the compiled grammar as too large)
- Set `DB_PATH=<scratch path>` to experiment without touching `data/learning-studio.db`

## Layout

- `shared/`: enumerations (`domain.ts`), API types and Zod inputs (`api.ts`), proposal payloads, lesson blocks and answers (`lessons.ts`). Used by both sides.
- `backend/src/services/`: domain logic; each function takes `db` first. `backend/src/ai/`: Claude flows. `backend/src/app.ts`: routes.
- `backend/src/db/migrations/`: numbered SQL files, applied on start. Add a new file; never edit an applied one.
- `frontend/src/pages`, `frontend/src/components` (lesson widgets and the diagram registry in `components/lesson/`); hash routes in `router.tsx`. Styles in one `styles.css` using the Studio tokens.
- `prompts/*.txt`: system prompts, one per AI task.

## Rules

- **AI proposes, the user decides.** AI output that changes the map becomes `proposals` rows, never direct writes.
- **AI generates data, never code.** Claude fills JSON for fixed components.
- **Every Claude call goes through `callStructured()`** (Zod validation, one retry with the errors, logged in `ai_runs`). Default model `claude-opus-5-5`.
- **Status is measured.** Never store a hand-entered progress or mastery value. Users can only set `status_override`.
- **Archive, don't delete.** Record a `topic_events` row for every topic change, via `recordEvent()`.
- Enumerations live in `shared/domain.ts`, not in SQL CHECK constraints.
- SQL placeholders are plain `?` only. Numbered `?1` fails on Node 22.14's `node:sqlite` ("column index out of range"); repeat the argument instead.
- Pin dependency versions exactly. Match the existing style: no semicolons, single quotes, 2-space indent, few comments.
- Phase 2 and Phase 3 "stop for review" steps mean: stop and show the user the generated output before building further.
