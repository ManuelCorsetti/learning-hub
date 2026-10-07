# Learning Studio — Phase 2 & 3 Plan

Follows on from [phase-1-plan.md](phase-1-plan.md) and uses the tables in
[data-model.md](data-model.md).

## Status and where to start

- **Phase 1 is built** (build steps 1–9). Its prompt-tuning reviews (steps 6
  and 7) still need to happen on real notes.
- **Phase 2 is next**, starting at build step 10 below. Phase 3 comes after
  Phase 2 is in use.

Where Phase 2 plugs into the existing code:

| Need | Where |
|---|---|
| New tables | Add `backend/src/db/migrations/0002_phase2.sql`, copying the "DDL — Phase 2" block from `data-model.md` verbatim. Migrations apply on server start. Never edit `0001`. |
| Block and lesson schemas | `shared/` (e.g. `shared/lessons.ts`), so the API, the AI call and the React widgets share one Zod definition |
| Claude calls | `callStructured()` in `backend/src/ai/client.ts`: Zod schema, plus a `check()` for rules that need the database, retry once, logged in `ai_runs`. Follow `backend/src/ai/capture.ts` as the example. New task names are already in `AI_TASKS` (`generate_lesson`). |
| Prompts | `prompts/lesson_generator.txt` (new) |
| Mastery | Replace the body of `measureTopics()` in `backend/src/services/status.ts` with the FSRS aggregate. The pure rule `measure()` (coverage × retention, 80 % threshold) and its tests already exist; keep the signature, and every page picks it up. |
| Override auto-resolve | `resolveOverrides()` in `backend/src/services/topics.ts`. Call it after recording attempts. |
| Routes | `backend/src/app.ts` |
| UI | `frontend/src/pages/` and `frontend/src/components/`. Routes in `frontend/src/router.tsx`. |
| Scheduler | `ts-fsrs` (not installed yet). Pin the version and check its current API when adding it. |

Naming: the existing **Review** page is for AI suggestions. Call the
spaced-repetition page **Practice** (route `#/practice`) so the two don't clash.

---

# Phase 2 — Lessons, testing and spaced repetition

Phase 2 makes status **real**. Any topic gets a "Build lesson" action. You
read the content and get tested on it, and those answers feed a
spaced-repetition scheduler. Mastery % and derived status come from the
scheduler's output. Nothing is typed in by hand.

## Learning loop

```
 Learn            Check               Schedule            Review (later)
 concept blocks → questions inline → attempt → rating → scheduler → due date
                  (confidence asked                       │
                   before the answer                      ▼
                   is revealed)                   daily review queue
                                                  (due items from all topics)
```

1. **Learn**: read the concept, steps and diagram blocks in order.
2. **Check**: each concept is followed by 1–2 questions.
   - Before the answer is revealed, you pick a confidence: *guessing* /
     *fairly sure* / *certain*.
   - After answering you see the result and the `pitfall_note`.
3. **Schedule**: each answer becomes an `attempt` with a rating. The scheduler
   updates the item's `review_item_state` (next due date, stability).
4. **Practice**: a **Practice** page shows every item that is due, across all
   topics. Answers there update the schedule in the same way.

## Rating rules (answer → scheduler rating)

| Result | Confidence | Rating |
|--------|-----------|--------|
| Wrong (or score < 0.5) | any | 1 Again |
| Partly right (0.5 ≤ score < 1) | any | 2 Hard |
| Correct | guessing | 2 Hard |
| Correct | fairly sure / not given | 3 Good |
| Correct | certain | 4 Easy |

- *Wrong + certain* is recorded as **confidently wrong**. It is the strongest
  signal for the optimise loop in Phase 3.
- The rating is stored on the attempt, so changing these rules later does not
  rewrite history.

## Scheduler

- **FSRS** (Free Spaced Repetition Scheduler), via the `ts-fsrs`
  library. Use the default parameters and a desired
  retention of 0.9.
- `review_item_state` is a cache. To change parameters or upgrade the library,
  replay all attempts and rebuild it.
- Personal parameter fitting is Phase 3, once there are enough reviews.

## Mastery and status

These are defined in [data-model.md → How status works](data-model.md#how-status-works).

- **Mastery %** = coverage × retention. It decays without review.
- **Derived status**: `backlog` → `learning` → `solid`. It falls back to
  *learning* if retention decays, and the topic then shows *reviews due*.
- **Override**:
  - you can still mark a topic *learning*, or *solid (self-assessed)*;
  - the measured % is always shown next to it;
  - the override clears itself when measurement catches up.
- The home page bars and Next up switch from override-only to effective
  status. Next up also gains *reviews due* as a factor.

## Content model (blocks)

A lesson version is an ordered list of blocks, stored in
`lesson_versions.blocks_json` with a `schema_version`. There are **9 fixed
types**: the original 7 plus 2 that the existing article format needs.

**Teaching blocks**: no review item.

| Type | Fields | Notes |
|------|--------|-------|
| `concept` | `id`, `title`, `body_markdown`, `callout?` | `callout` = the existing article's spark note. |
| `steps` *(new)* | `id`, `title`, `intro?`, `steps: [{title, text}]` | From the article's "modelling workflow" section. |
| `diagram` *(new)* | `id`, `diagram_key`, `caption?` | `diagram_key` must be in a fixed registry of React components. Initial keys are the five v0.1 visuals, using the keys already in `seed/articles/dimensional-modelling.json`: `star`, `schema`, `hierarchy`, `conformed`, `marketing`. Their React components and CSS are in git history: `git show 8b9778e:src/main.jsx` (the `Visual` function) and `git show 9328ae1:src/styles.css`. The AI can only choose a key that exists. |

**Interactive blocks**: each gets a review item.

| Type | Fields | Grading |
|------|--------|---------|
| `quiz_mcq` | `id`, `question`, `options` (exactly 4), `correct_index` (0–3), `pitfall_note` | exact |
| `quiz_true_false` | `id`, `statement`, `answer`, `pitfall_note` | exact |
| `fill_in_blank` | `id`, `sentence` (contains `___`), `acceptable_answers` (≥ 1) | case-insensitive, trimmed |
| `code_challenge` | `id`, `language`, `snippet`, `expected_answer`, `hint` | normalised text compare, never executed |
| `ordering` | `id`, `prompt`, `items_shuffled`, `correct_order` | score = share of items in the correct position |
| `project_prompt` | `id`, `description`, `success_criteria` (≥ 1) | self-ticked checklist. Logged, **not scheduled**, not part of mastery |

**Lesson**: `{ schema_version, title, blocks[] }`. Validation rules:
- the server sets the topic, not the AI;
- the block list is a union with `type` as the discriminator;
- block ids are unique, and the server checks them (and assigns them if the AI
  leaves them out);
- `correct_order` is a permutation of `items_shuffled`, and the two are not
  already in the same order;
- every interactive block comes after at least one teaching block;
- exactly one `project_prompt`, and it is the last block.

## Lesson generation rules (put these in the prompt)

- 3–5 `concept` blocks.
- Each concept is followed by 1–2 interactive blocks. Mix the types as they
  fit; not every type is needed every time.
- At least one trick question per concept.
- Every question tests something **explicitly taught** earlier in the same
  lesson.
- Question and option wording must not hint at the answer. The reasoning goes
  in `pitfall_note`.
- `diagram` blocks may only use registered keys. The list of keys is included
  in the prompt.
- One `project_prompt` at the end.

## Existing articles → lessons

| Article | Phase 2 action |
|---------|----------------|
| Dimensional modelling | Import `seed/articles/dimensional-modelling.json` as a lesson with `origin = imported_article`, `created_by = user`, version 1. Sections map to blocks: body+callout → `concept`, steps → `steps`, visual → `diagram`. **This is the first lesson to test the renderer with.** It has no questions. In Phase 2, add them by calling the lesson generator with the existing teaching blocks as context and asking only for interactive blocks; save the result as version 2 (`created_by = ai`). The co-authoring flow (`lesson_patch` proposals) is Phase 3. |
| Change data capture, RL for marketing, Cloud networking | No content yet. Use "Build lesson" (AI) when you choose to learn them. |

## Build order (continues from Phase 1)

10. **Block schemas and generation script.**
    - The schemas above, plus a standalone script that generates a lesson for
      a test topic.
    - **Stop for review**: tune `prompts/lesson_generator.txt` for good trick
      questions.
11. **Phase 2 migration**: `lessons`, `lesson_versions`, `review_items`,
    `study_sessions`, `attempts`, `review_item_state`.
12. **Import the dimensional-modelling article** as lesson v1. Port the
    `Visual` components into the diagram registry (see the `diagram` block row
    for where they are in git history).
13. **Store and endpoint**: `POST /topics/{id}/lessons` → generate → validate →
    save v1 → create review items.
14. **Widgets, one at a time, each tested on its own:** concept → steps →
    diagram → true_false → mcq → fill_in_blank → project_prompt → ordering →
    code_challenge.
15. **Lesson page**: latest version, blocks in order, confidence prompt,
    `pitfall_note` after answering. Reuse the v0.1 article reading layout
    (two columns with a sticky table of contents): the `Article` component in
    `git show 8b9778e:src/main.jsx` and its CSS in `git show 9328ae1:src/styles.css`.
    Add a "Build lesson" button to the topic panel.
16. **Attempts and scheduling**: `POST /attempts` → grade → rate → update
    `review_item_state`.
17. **Practice page** (`#/practice`): due items across topics, in a `review`
    study session. Show the count of reviews due in the top bar.
18. **Mastery service**: coverage, retention, mastery %, derived and effective
    status, override auto-resolve. Feed it into the home bars, the graph
    colours and Next up.

## Phase 2 non-goals

- Executing code, whether written by the user or the AI.
- Fitting personal scheduler parameters (Phase 3).
- Variants of the same question (Phase 3).

---

# Phase 3 — Co-authoring and the optimise loop

This needs both earlier phases: lessons to edit and attempts to learn from.

## Features

1. **Co-author mode**.
   - A split-screen lesson page: the lesson on the left, chat with the agent on
     the right (`chat_threads`, `chat_messages`).
   - Example requests: "make this harder", "add a trick question about X",
     "the analogy in block 2 is poor".
   - The agent replies with a `lesson_patch` proposal: add / replace / remove /
     reorder blocks, validated against the block schemas and shown as a diff.
   - Accepting writes a new `lesson_versions` row. Rejecting changes nothing.
   - **Rollback** = a new version that copies an older one
     (`based_on_version_id`).
   - Patch rules for block ids (data-model rule 8):
     - a reworded question that tests the same thing keeps its id, so its
       schedule carries on;
     - a question that tests something different gets a new id, so a new
       schedule starts;
     - the diff view shows which blocks will have their schedule reset.
2. **Optimise loop**.
   - After a lesson or a review session, the agent reads the signals:
     - confidently-wrong attempts;
     - items with many lapses or high difficulty;
     - topics whose retention keeps decaying;
     - overrides that measurement contradicts.
   - It then proposes map changes through the normal proposals system, for
     example:
     - "Confidently wrong on 3 decorator questions. Add a prerequisite topic on
       closures?"
     - "These two topics overlap heavily. Merge them?"
3. **Placement test ("test out")**.
   - A short generated quiz (a `placement` study session) for a topic marked
     *solid (self-assessed)*.
   - Passing turns the self-assessment into measured mastery.
4. **Personal scheduler parameters**.
   - Once there are enough attempts (several hundred reviews), fit FSRS
     parameters from your own history.
   - Store them in `scheduler_params` and replay to rebuild
     `review_item_state`.
5. **Question variants** *(optional)*.
   - Have the AI write alternative wordings of a review item, so reviews test
     the idea rather than memory of the wording.
   - This would add a `review_item_variants` table, with attempts referencing
     the variant shown. That is an additive change.

## Build order (continues)

19. `lesson_patch` proposal kind, diff view, apply as a new version, rollback.
20. Co-author chat UI (reuses proposals and versioning). Phase 3 migration for
    the chat tables.
21. Optimise loop: analyse attempts → map change proposals.
22. Placement tests.
23. Scheduler parameter fitting and replay.

## Phase 3 non-goals

- No auto-applied AI changes of any kind.
- No sandboxed AI-generated code. If a concept ever really needs a custom
  interactive component, treat it as its own project (iframe sandbox, smoke
  test, draft state, versioned rollback). Until then, add new components to the
  diagram registry by hand.

---

## Open questions (decide before Phase 2)

- ~~Mastery thresholds~~ **Decided:** 80 % mastery, every scheduled item
  tested and in the review state (`SOLID_MASTERY_THRESHOLD` in
  `shared/domain.ts`).
- **Overrides**: should a self-assessed *solid* be enough to unlock
  prerequisites in Next up, or only a measured one? (Phase 1 counts it.)
- **Review cap**: should a session have a daily cap on reviews?
- **Lesson design**: is a design needed for the lesson and review pages, or
  are the existing article page styles enough?
