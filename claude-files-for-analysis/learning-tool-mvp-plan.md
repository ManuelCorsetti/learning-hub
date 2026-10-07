# Learning Map — Build Plan

## What this is
A personal **learning map**: a tracker of everything you want to learn, where
AI helps capture, group and order topics. Building a lesson for a topic is an
optional action on a node, not the core of the app.

Built in three phases. Each phase is useful on its own and later phases only
add to it.

1. **Learning map**: capture, group, graph view, next-up (no lessons yet)
2. **Lessons**: AI-generated lessons made of fixed widgets, plus response logging
3. **Co-authoring + optimise loop**: edit lessons with the agent, let results reshape the map

## Stack (standalone app)
- **Frontend**: React + Vite. Renders from fixed components only.
- **Backend**: Python (FastAPI). Owns AI calls, validation, storage.
- **DB**: SQLite. Plain tables for the graph; a few hundred nodes doesn't need
  a graph DB, and no embeddings/vector DB. Postgres later if it ever matters.
- **AI**: Claude API via the `anthropic` SDK; every response validated with Pydantic.
- Single local user, no auth, functional styling only.

## Rules that apply to every phase
1. **AI proposes, you decide.** The AI only writes `proposals` (new topic,
   cluster, edge, lesson patch). Nothing changes until you accept it.
2. **AI generates data, never code.** It fills JSON for fixed, pre-built
   components. It never writes code that runs live in the app.
3. **One shared AI call pattern**: prompt → JSON → Pydantic validation → on
   failure retry once with the validation error appended → on second failure
   return a clear error. Never guess or silently repair.
4. **Prompts live in their own files** (e.g. `prompts/capture.txt`,
   `prompts/group.txt`, `prompts/lesson_generator.txt`) so they can be tuned
   without touching code.

---

# Phase 1 — Learning map

## Data model
- `topics`: id, title, summary, why_i_care, status (`backlog` | `learning` |
  `solid`), cluster_id, created_at
- `clusters`: id, name, summary
- `edges`: from_topic_id, to_topic_id, type (`prerequisite_of` | `related_to`
  | `part_of`), rationale
- `goals`: id, title, target_date (optional); topics can link to a goal
  (e.g. "internal article on AI and data engineering")
- `resources`: id, topic_id, title, url_or_note
- `proposals`: id, kind (`new_topic` | `cluster` | `edge`), payload_json,
  status (`pending` | `accepted` | `rejected`), created_at

## Features
1. **Capture**: one text box. Paste a messy brain-dump or an article title;
   Claude extracts candidate topics, de-duplicates against existing ones, and
   creates `new_topic` proposals. Seed the first run with the current backlog:
   Python CLI tools, ABCs/interfaces, Go vs Rust, dbt (incremental models,
   macros, testing), dimensional modelling (Kimball, Data Vault, Medallion),
   agentic AI dev (tool use, structured outputs, evals, sandboxed execution).
2. **Group**: an "Organise" button. Claude proposes clusters and
   `prerequisite_of` / `related_to` edges across all topics, each with a
   one-line rationale. Accept/reject per item, with a batch-accept option.
   Re-runnable: it proposes *changes* to existing clusters, not a rebuild.
3. **Graph view**: React Flow (or Cytoscape.js). Node colour = status,
   cluster = colour band, goals as special nodes. Click a node for a side
   panel: summary, why I care, edges, resources, status buttons.
4. **Next up**: ranked list of what to learn next. Score = prerequisites
   already solid + leverage (number of dependants) + link to an active goal.
   Scoring is plain deterministic Python; Claude only writes the short
   "why this next" for the top 3.

## Build order (separate steps/commits)
1. **Scaffold**: FastAPI + Vite React, health check, confirm they talk locally
2. **Database**: SQLite tables above + simple migrations
3. **Topics CRUD + list UI**: add/edit topics by hand, set status, no AI yet
4. **AI call helper**: the shared prompt → validate → retry-once pattern, with
   a standalone script that tests it on a sample brain-dump
5. **Proposals system**: create/list/accept/reject endpoints plus a simple
   review screen. Everything AI-driven depends on this
6. **Capture flow** (feature 1). **Stop for review** and tune the extraction prompt
7. **Group flow** (feature 2). Stop for review and tune the grouping prompt
8. **Graph view** (feature 3): read-only first, then add side-panel actions
9. **Next up** (feature 4)

## Phase 1 non-goals
- No lessons, quizzes or widgets
- No mastery scores (status is set by hand until Phase 2 produces data)
- No embeddings, no graph DB, no auto-applied AI changes

---

# Phase 2 — Lessons

Adds a "Build lesson" action to any topic. A lesson is an ordered list of
fixed widget blocks, generated as JSON by Claude.

## Content model (7 fixed widget types)
1. `concept`: short explanation (markdown, ~150-300 words)
2. `quiz_mcq`: question, 4 options, correct index, `pitfall_note` explaining
   why the wrong answers are tempting (trick questions live here)
3. `quiz_true_false`: statement, boolean answer, `pitfall_note`
4. `fill_in_blank`: sentence containing `___`, list of acceptable answers
   (case-insensitive match)
5. `code_challenge`: snippet with a blank or bug, language tag, expected
   answer, hint. Display and text-compare only; code is never executed
6. `ordering`: shuffled items the user puts in the right order
7. `project_prompt`: end-of-lesson task with a `success_criteria` checklist,
   ticked manually (not auto-graded)

## Pydantic schema (source of truth)

```python
from pydantic import BaseModel
from typing import Literal

class ConceptBlock(BaseModel):
    type: Literal["concept"]
    id: str
    title: str
    body_markdown: str

class QuizMCQBlock(BaseModel):
    type: Literal["quiz_mcq"]
    id: str
    question: str
    options: list[str]  # exactly 4
    correct_index: int
    pitfall_note: str  # shown only AFTER answering

class TrueFalseBlock(BaseModel):
    type: Literal["quiz_true_false"]
    id: str
    statement: str
    answer: bool
    pitfall_note: str

class FillInBlankBlock(BaseModel):
    type: Literal["fill_in_blank"]
    id: str
    sentence: str  # contains "___"
    acceptable_answers: list[str]

class CodeChallengeBlock(BaseModel):
    type: Literal["code_challenge"]
    id: str
    language: str
    snippet: str  # contains blank or bug
    expected_answer: str
    hint: str

class OrderingBlock(BaseModel):
    type: Literal["ordering"]
    id: str
    prompt: str
    items_shuffled: list[str]
    correct_order: list[str]

class ProjectPromptBlock(BaseModel):
    type: Literal["project_prompt"]
    id: str
    description: str
    success_criteria: list[str]

Block = (
    ConceptBlock | QuizMCQBlock | TrueFalseBlock | FillInBlankBlock
    | CodeChallengeBlock | OrderingBlock | ProjectPromptBlock
)

class Lesson(BaseModel):
    topic: str
    blocks: list[Block]
```

## New tables
- `lesson_versions`: lesson_id, topic_id, version, blocks_json, created_by
  (`ai` | `user`), created_at. Lessons are stored versioned from the start
  (version 1 on generation) so Phase 3 needs no migration
- `responses`: lesson_id, block_id, block_type, correct (bool), raw_answer,
  answered_at
- Mastery is **derived**, never stored: aggregate `responses` per topic
  (% correct, recent trend, confidently-wrong count)

## Data flow
1. On a topic, click "Build lesson". Backend sends Claude the topic, its
   summary, its prerequisite topics and the lesson system prompt
2. The prompt asks for 3-5 `concept` blocks, each followed by 1-2 quiz-style
   blocks (mixing MCQ, true/false, fill-in-blank, ordering, code challenge as
   fits; not every type every time), at least one trick question per concept,
   and a single `project_prompt` at the end
3. Validate with the shared retry-once pattern, store as `lesson_versions` v1
4. Frontend renders blocks in order with a `switch` on `block.type`
5. Every interactive widget logs to `responses` on submit
6. The map now shows derived mastery on each node, and "Next up" can use it

## Lesson-generation rules (put these in the prompt)
- Every question must test something **explicitly taught** in an earlier
  `concept` block of the same lesson. No questions on untaught material
- Question and option wording must **not hint at the answer**; the reasoning
  goes in `pitfall_note`, which is shown only after answering

## Build order (continues from Phase 1)
10. **Schema + generation script**: the Pydantic models above plus a
    standalone script that generates a lesson for a test topic. **Stop for
    review**; this is the riskiest step and the prompt needs tuning for good
    trick questions
11. **Store + endpoint**: `POST /topics/{id}/lesson` → generate → validate →
    save as version 1
12. **Widgets, one at a time, tested in isolation**, simplest first:
    concept → true_false → mcq → fill_in_blank → project_prompt → ordering →
    code_challenge (drag/drop and syntax display are the fiddliest)
13. **Lesson page**: fetch the latest version, render blocks in order
14. **Response logging**: `POST /responses`, called from every interactive widget
15. **Mastery on the map**: derive per-topic mastery, colour nodes by it, feed
    it into Next up

## Phase 2 non-goals
- No executing code (user or AI), including in `code_challenge`
- No spaced repetition scheduler (the `responses` data is the foundation for it)

---

# Phase 3 — Co-authoring + optimise loop

Needs both earlier phases: lessons to edit, and responses to learn from.

## Features
1. **Co-author mode**: split-screen lesson page. Lesson on the left, chat
   with the agent on the right. You say "make this harder", "add a trick
   question about X", "the analogy in block 2 is poor". The agent replies with
   a `lesson_patch` proposal (add / replace / remove / reorder blocks,
   validated against the same block schemas) shown as a diff. Accept creates a
   new `lesson_versions` row; reject changes nothing. Rollback is just
   pointing at an earlier version
2. **Optimise loop**: after a lesson, the agent reads your responses and
   proposes map changes through the normal proposals system: "confidently
   wrong on 3 decorator questions, add a prerequisite topic on closures?",
   "these two topics overlap heavily, merge?"

## Build order (continues)
16. Add `lesson_patch` to proposals; diff view and apply-as-new-version
17. Co-author chat UI (reuses proposals + versioning)
18. Optimise loop: analyse responses → map change proposals

## Phase 3 non-goals
- No auto-applied AI changes of any kind
- No sandboxed AI-generated code. If a concept ever truly needs a custom
  interactive component, revisit it as its own project (iframe sandbox,
  smoke test, draft state, versioned rollback)

---

## Notes for the Claude Code session
- Give Claude Code this whole file as context up front, then work one build
  step at a time
- Stop for review at steps 6, 7 and 10; those are the prompt-tuning points
- Keep each system prompt in its own file under `prompts/`
