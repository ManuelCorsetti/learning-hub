# Learning Studio — Phase 4 Plan: learning that sticks

Follows on from [phase-2-3-plan.md](phase-2-3-plan.md) and adds to the tables in
[data-model.md](data-model.md).

Phases 1–3 built the machinery: a map, generated lessons, FSRS reviews,
co-authoring and an optimise loop. This plan looks at the app as a *learning
system*. Does an hour spent in it become knowledge you still have in a month and
can use at work? It lists what the review found, the principles to design
against, and the changes, ordered by learning value for the effort.

## Status and where to start

| Track | What | Size | When |
|---|---|---|---|
| **A. Honest measurement** | Retries, mastery horizon, rating rules, response time | Small, no AI | **Start here.** Every later change is judged by these numbers |
| **B. Better retrieval** | Shuffling, re-study on a miss, recall formats, variants, leeches | Small to medium | After A |
| **C. Teaching that encodes** | Learner model in prompts, diagrams as data, worked examples, own-words prompts, pre-questions | Medium, prompt work | After A, alongside B |
| **D. Pacing and metacognition** | Today, review cap, interleaving, session summary, Insights, concept mastery, goal readiness | Medium, no AI | After A |
| **E. New avenues** | Own sources, Ask → question, teach-back, synthesis, projects, adaptive placement, phone | Larger bets | One at a time |

Build steps continue the numbering of the earlier phases (24 onwards, see
[Build order](#7-build-order-continues-from-step-23)). Baseline when this plan
was written: 89 tests pass, typecheck clean.

---

## 1. What the current loop gets right

These match what learning research supports, and the plan keeps all of them:

- **Retrieval practice with feedback.** Lessons test straight after teaching, and
  every answer gets the right answer and a `pitfall_note`.
- **Spacing.** FSRS schedules every question, and status decays without review.
- **Confidence before the reveal.** A metacognitive check, and the raw material
  for the *hypercorrection effect*: errors made with high confidence are the ones
  feedback corrects best.
- **Questions aimed at misconceptions.** The trick-question rule and plausible
  distractors.
- **Prerequisites first.** Next up ranks by readiness, so new material lands on
  known ground.
- **Personal context.** The profile and the planner put examples in the
  learner's own stack.
- **Measured, not claimed.** Placement tests turn "I know this" into evidence.

## 2. Findings

Checked against the code, and with small scripts that call
`backend/src/services/scheduler.ts` and the real services on an in-memory
database (default FSRS parameters).

| # | Finding | Evidence | Why it matters for learning |
|---|---|---|---|
| F1 | **"Answer again" counts as a review.** After the feedback shows the right answer, re-answering records a rated attempt that FSRS replays. | A lesson where *every first answer was wrong*, re-answered as *Certain*: mastery 100 % and derived **solid** minutes later, still solid (83 %) a day later, *learning* only after 3 days. The topic drops out of Next up, and a *solid (self-assessed)* override resolves itself as if confirmed. | One button breaks "status is measured". |
| F2 | **Mastery uses recall *now*.** | Recall now is 1.00 straight after any answer, right or wrong. Predicted recall 30 days out tells them apart: Easy 0.79, Good 0.67, Hard 0.61, Again 0.47. | The open question in phase-2-3-plan.md. Mastery is highest exactly when it says least. |
| F3 | **In-lesson answers come seconds after reading.** *Certain* and right → Easy → first review in **8 days** (stability 8.3). | The FSRS defaults come from flashcard logs, where the first rating is the first time the card is seen, with no text read just before. | Short-term memory is scored as long-term memory, and the most useful early review comes late. |
| F4 | **A correct guess is a pass.** Right + *Guessing* → Hard, which FSRS counts as recalled. | True/false is right half the time by luck, multiple choice a quarter. | Schedules grow on luck. |
| F5 | **Reviews repeat the identical item.** Same wording, same option order, same starting order for ordering. | `options` and `items_shuffled` are fixed per version and Practice renders them as stored. | Learners remember "it's C", not the idea. Recognition formats dominate; free recall exists only as fill-in-the-blank and code. |
| F6 | **A miss in Practice doesn't lead back to the teaching.** | Feedback shows the note, and the card links the lesson, not the section the question tests. | Right after an error is the best moment to re-study, and today it costs a search. |
| F7 | **Practice is one uncapped queue in due order.** | `ORDER BY s.due_at`. Items answered together share due times, so a lesson's questions come back as a block. | No pacing (a big lesson day becomes a review avalanche), no interleaving, no end-of-session summary. |
| F8 | **Diagrams exist for one topic.** | All five `DIAGRAM_KEYS` come from the dimensional-modelling article. | Every other lesson is text only: no dual coding. |
| F9 | **Response time is never recorded.** | `attempts.duration_ms` exists; the UI never sends it. | A lost signal: slow-right versus fast-right, and data for tuning. |
| F10 | **Confidence is never shown back.** | Only Optimise reads it. | Calibration feedback is the cheapest metacognition gain, and it is unused. |
| F11 | **Lesson writing ignores performance.** | `topicContext()` (generator, planner, placement) has no attempts, weak concepts or confidently-wrong patterns. Only the co-author editor sees `question_stats`. | New lessons can't aim at what this learner gets wrong. |
| F12 | **Projects are ticked by hand and never revisited.** | `project_prompt` is unscheduled and stores no evidence. | Transfer to real work, the point of learning, is not measured. |
| F13 | **The learner's own questions are thrown away.** | Ask answers are not saved unless turned into a lesson note. | A question someone asks is the clearest sign of a gap, and good material for a review item. |
| F14 | **Mastery exists only per topic.** | Questions already belong to the concept they follow (`toSections()` in `LessonPage.tsx`), but nothing measures per concept. | You can't see which part of a lesson is weak. |

## 3. Principles to design against

| Principle | In short | Where it shows up here |
|---|---|---|
| Retrieval practice | Recalling beats re-reading; producing an answer beats recognising one | Recall formats, variants (B3, B4) |
| Spacing and successive relearning | Retrieve to success again across spaced sessions | FSRS already; retries must not fake a spaced success (A1) |
| Interleaving | Mixing related material trains telling things apart | Practice order, discrimination questions (D2, E5) |
| Generation and pretesting | Trying before being taught improves later learning, even when the try is wrong | Pre-questions (C5) |
| Elaboration and self-explanation | Explaining why and how ties new ideas to known ones | Own-words prompts, teach-back (C4, E2) |
| Worked examples, then fading | Novices learn more from studying examples, experts from solving problems | Worked and faded examples by level (C2) |
| Dual coding | Words plus a picture of the structure | Diagrams as data (C3) |
| Calibration and hypercorrection | Know what you don't know; confident errors correct best with feedback | Session summary, Insights (D3, D4) |
| Variability and transfer | Varied contexts make knowledge usable elsewhere | Variants, projects with evidence (B4, E4) |

Sources are listed under [References](#references).

---

## 4. The plan

### Track A — Honest measurement (do first)

No AI changes and few files, but mastery, retention and the Optimise signals
decide everything after this, so they must be trustworthy first.

**A1. Retries don't count as reviews.**
- Keep "Answer again": trying again until right is good practice. Record it with
  `rating = NULL`, so it is logged and never scheduled. `AttemptInput` gains
  `retry: true`; the server writes `retry: true` into `answer_json` and forces
  the rating to null. The button reads *Try again (practice only, the schedule
  doesn't change)*.
- History: in `refreshSchedule()`, count only the first rated attempt per item
  per `lesson` or `placement` session, since those pages never serve an item
  twice. Practice sessions do re-serve an item minutes after a miss (FSRS
  learning steps), so they keep every rated attempt without the `retry` flag;
  past Practice retries can't be told apart and stay as they are. Add a rules
  version to `schedulerVersion()` so `rebuildIfStale()` replays once on start.
- Test: the F1 scenario stays *learning*, with mastery under 50 %.
- Where: `shared/api.ts` (`AttemptInput`), `practice.ts` (`recordAttempt`),
  `scheduler.ts`, `Questions.tsx`.

**A2. Mastery measures durable recall.**
- Retention = mean predicted recall at `now + horizon`, not at `now`. Default
  horizon 30 days, stored as the setting `mastery_horizon_days`.
- With the default parameters, *solid* (≥ 80 %) then needs at least one
  successful spaced review:

  | Answers | Predicted recall in 30 days |
  |---|---|
  | Good on day 0 (twice, learning step) | 0.67 |
  | … then Good on day 2 | 0.82 |
  | Easy on day 0 only | 0.79 |
  | Wrong on day 0, then Good on days 1 and 4 | 0.79 |
  | … then Good on day 14 | 0.89 |

- The horizon moves with `now`, so mastery still decays without review.
- The lesson and topic pages show both figures: "Mastery 64 % · recall now 98 %".
- This answers the phase-2-3 open question *Retention right after a wrong
  answer* without a special rule for learning states.
- Where: `measureTopics()` in `status.ts` (`measure()` stays pure; update its
  tests), `Measurement` in `shared/api.ts` gains `recallNow`, Settings.

**A3. Rating rules v2.** Ratings are stored per attempt, so history is untouched.

| Result | Confidence | Now | Proposed |
|---|---|---|---|
| Right, `quiz_mcq` or `quiz_true_false` | guessing | 2 Hard | **1 Again**: a guess is not recall |
| Right, in a `lesson` session | certain | 4 Easy | **3 Good**: seconds after reading is not evidence of retention |
| Anything else | any | unchanged | unchanged |

- Practice and placement keep Easy: there is no text read just before.
- Revisit the lesson cap once personal parameters are fitted (Settings → Review
  scheduler fits the first-answer stabilities, which captures the same effect).
- Feedback for a lucky guess: "Right, but you were guessing, so it comes back soon."
- Where: `rate()` in `grading.ts` takes the block type and session kind; update
  the rating table in phase-2-3-plan.md.

**A4. Record response time.** `QuestionCard` measures from the moment the
question is first in view (IntersectionObserver, since a lesson renders every
card at once) to the confidence click, and sends `duration_ms`. No rule uses it
yet; it feeds Insights (D4) and Optimise.

### Track B — Better retrieval practice

**B1. Shuffle at display.** MCQ options and ordering items are shuffled each
time a question is shown. The widget maps the choice back to the stored index,
so answers, grading and history don't change. Add a rule to the generator,
editor and placement prompts: *never refer to an option by letter or position*
(the pitfall note would point at the wrong one).

**B2. Re-study on a miss.** When a Practice answer is wrong or partly right,
show the teaching block the question follows ("From the lesson: *Slowly
changing dimensions*"), collapsed under the feedback, with *Open in lesson*
linking to that section. Move the section rule from `toSections()` to
`shared/lessons.ts` and add `teaching_block` to `PracticeItem`. No AI.

**B3. A free-recall question type.** New `short_answer` block: `question`,
`model_answer`, `key_points` (1–4).
- Graded by the existing `grade_answer` task against the key points: correct,
  partly or wrong, with one line of feedback. With no AI, the learner marks
  their answer against the model answer after the confidence click.
- Generator rule: at least one recall question (fill-in, code or short answer)
  per concept, and multiple choice plus true/false at most half of a lesson's
  questions.
- One more member of the same block union (keep the one-union rule from
  CLAUDE.md).
- **Stop for review**: grading consistency on 20 real answers (`npm run ai:runs`).

**B4. Question variants** (the optional Phase 3 item, now worth doing because
of F5).
- New table `review_item_variants` (`id`, `review_item_id`, `block_json`,
  `ai_run_id`, `created_at`, `retired_at`) and a nullable `attempts.variant_id`,
  the additive change phase-2-3-plan.md foresaw.
- *Prepare reviews* on a lesson (user-triggered, like Build lesson) asks Claude
  for two variants per scheduled question: the same idea in different wording
  and context and, where it fits, a different format (MCQ → fill-in or short
  answer) to move recognition towards recall. Validated with the same block
  schemas and checks.
- Practice shows the variant seen least recently; the lesson page always shows
  the original. Variants are listed, and removable, in the lesson's History.
  An edit that gives a question a new id retires its variants.
- **Stop for review**: do the variants really test the same idea? If not, the
  shared schedule means nothing.

**B5. Leeches.** An item with 4 or more lapses is a *leech*: more drilling
rarely helps. Mark it in Practice ("forgotten 4×: this question may need
rewriting"), list leeches on the lesson page, and let Optimise propose a
`lesson_patch` for them (reword, split, or add the missing teaching) through the
lesson editor, with the item's answers as the note. Today Optimise only
proposes map changes.

### Track C — Teaching that encodes better

**C1. Send a learner model with every lesson request.** Add `my_performance`
to `topicContext()`, which the generator, planner and placement use:
- measured status and durable mastery of the topic, its parent and its
  prerequisites;
- weak concepts (section mastery, D5);
- confidently-wrong questions in related lessons (question and right answer,
  up to 10);
- calibration in one line ("right 64 % of the time when certain").

Prompt rule: aim questions at the misconceptions shown, and don't re-teach what
is solid. **Stop for review**: one lesson for a weak topic and one for a strong one.

**C2. Worked and faded examples.**
- `worked_example` (teaching): a problem, steps (each an action and the reason
  for it), and the result.
- `faded_example` (question): the same shape with one or two steps left blank,
  scored by the share of blanks right, like ordering.
- Level rule (expertise reversal): *fundamentals* = worked example then faded
  example; *applied* = faded example; *advanced* = problems only.
- **Stop for review** with the planner and generator prompts.

**C3. Diagrams as data.** Three generic teaching blocks, drawn by fixed
components from JSON, so any topic can have a picture with no AI-written code:

| Block | Data | Drawn with | Good for |
|---|---|---|---|
| `flow` | nodes (≤ 12: label, optional group) and edges (from, to, label) | dagre, already a dependency | pipelines, architectures, request paths, state machines |
| `compare` | 2–4 options × criteria, short cells | a table | Go vs Rust, Kimball vs Data Vault |
| `sequence` | actors and ordered messages | swim lanes | protocols, CDC log → consumer, OAuth |

- Checks: every edge end exists, sizes are capped, labels are short. The
  registry `diagram` block stays for hand-made visuals.
- A diagram may be followed by a question about it ("which step is missing?").
- Adding blocks grows the structured-output grammar. Test generation with all
  new block types against the API before building the widgets.
- **Stop for review.**

**C4. In your own words.** An optional box after each concept: "Explain this
to a colleague in two sentences." One `claude-haiku-5-5` call (new task
`self_explain`, through `callStructured()`) compares it with the concept and
replies in one line with what is missing or wrong. Not scheduled. The
explanation and the reply are saved in the lesson's Notes thread, so future
lessons and edits see them through `my_notes`.

**C5. Pre-questions ("Try first").** Optional at the start of a lesson: the
first question of each section is shown up front, answered without a confidence
rating and not scored (`rating = NULL`, `answer_json.pretest = true`), and the
answer is not revealed. The learner then reads, and the same questions come
back in place, rated as usual. Off by default; a toggle on the lesson page. Use
Insights to check whether 7-day recall goes up.

### Track D — Pacing and metacognition

**D1. Today.** A block at the top of Home: reviews due today, the next lesson
to do (from Next up) and a 7-day review forecast.
- A daily review cap (setting `daily_review_cap`, proposed 60) answers the
  phase-2-3 open question *Review cap*. Items in learning or relearning steps
  come first, then the lowest predicted recall; the rest carries over.
- Build lesson shows "adds about N reviews over the next week", so new material
  can be paced.

**D2. Interleaved Practice.** Order due items so consecutive ones come from
different topics where possible (round-robin across topics, most at risk first
within a topic). Keep a *Focus* filter (one topic or one goal) for crunch times.

**D3. Session summary.** At the end of a Practice round or a lesson: right,
partly and wrong counts, time spent, the *certain but wrong* items first with
their notes (the ones most worth re-reading now), any leeches, and when the next
reviews are due.

**D4. Insights page** (`#/insights`). Everything is derived from `attempts`
and replay; nothing new is stored.
- **Calibration**: share right per confidence level over 30 and 90 days.
  Flags overconfidence (*certain* right less than 85 % of the time) and
  underconfidence (*guessing* right more than 60 %).
- **True retention**: the pass rate of reviews on items in the `review` state
  against the 0.9 target. This shows whether the scheduler suits you.
- Reviews per day, time spent (A4) and the forecast.
- Durable mastery per area over time (replay to past dates).
- Accuracy by question type: recognition versus recall.

**D5. Mastery per concept.** Measure each section (the questions under the
concept they follow, using the rule moved to `shared/` in B2) with the same
`measure()`. Show a small bar per section in the lesson's table of contents, and
pass weak sections to C1, Optimise and the co-author editor.

**D6. Goal readiness.** For a goal with a `target_date`, show the durable recall
its topics are predicted to have on that date, plus the topics not started yet:
"At this pace 3 of 5 topics are ready by 12 March; start *Change data capture*
this week." Pure computation.

### Track E — New avenues

**E1. Learn from your own sources.** Paste an article, a docs page or your own
notes on a topic. Claude splits it into teaching blocks (condensed, with the
source named), and the existing `questions_only` mode writes the questions.
This turns a reading list into retrieval practice grounded in text you chose.
`origin = 'source'`; paste only, no fetching.

**E2. Teach-back.** *Explain it to me* on a topic page. You write an
explanation; Claude plays a sharp newcomer, asks up to three probing questions,
then returns observations (what was clear, what was missing or wrong) and
proposals: questions on the gaps as a `lesson_patch`, or a missing prerequisite
through the normal proposals. New table `teach_backs` (`topic_id`,
`messages_json`, `result_json`, `ai_run_id`, `created_at`). Not scheduled. Most
useful on topics that look solid: it tests explanation, which multiple choice
can't.

**E3. Ask → question.** In the Ask panel, *Make this a review question*: Claude
writes one question from the exchange and proposes it as a `lesson_patch` after
the block the selection came from. Your own curiosity becomes something you are
tested on.

**E4. Projects with evidence.** The project block gets a text field for what
you did (notes, a link, a pasted snippet). *Review my project* asks Claude to
check it against the success criteria (reading only; code is never run) and to
suggest a harder next project. Thirty days later the project returns in Today as
"Have you used this since?" (logged, not scheduled): evidence of transfer.
Projects stay out of mastery.

**E5. Synthesis across topics.** For `related_to` pairs and prerequisite
chains, a *Connect* lesson of questions that need both topics ("log-based or
query-based CDC: which fits this case?"). Stored as a lesson on the later topic
with `origin = 'synthesis'`, so its items count there. Optimise suggests one
when answers show the two being confused.

**E6. Adaptive placement.** Two stages: six core questions; with five or more
right, six harder ones; otherwise stop and suggest a fundamentals lesson.
Shorter for both the expert and the novice, and the second stage is written
from the first stage's answers.

**E7. Practice on your phone.** Reviews are two-to-five-minute tasks, and
spare moments are where daily spacing actually happens. Make Practice an
installable page (web manifest, phone layout) served by `npm start` on the home
network or a private tunnel. There is no auth, so never expose it publicly; a
single shared token is the minimum before reaching beyond the local network.

Suggested order for E: E1 and E3 first (small, reusing existing flows), then
E2, E5, E4, E6, E7.

---

## 5. Data model changes (all additive)

| Change | Step | Notes |
|---|---|---|
| `answer_json.retry`, `answer_json.pretest` | A1, C5 | Flags for the record; `rating = NULL` is what keeps them out of the schedule |
| Settings `mastery_horizon_days`, `daily_review_cap` | A2, D1 | Key/value, no migration |
| Block types `short_answer`, `faded_example`, `worked_example`, `flow`, `compare`, `sequence` | B3, C2, C3 | The union only grows, so old lessons parse unchanged and `LESSON_SCHEMA_VERSION` stays 1 |
| `review_item_variants` table, nullable `attempts.variant_id` | B4 | Foreseen in phase-2-3-plan.md |
| `teach_backs` table | E2 | |
| `lessons.origin` gains `source` and `synthesis` | E1, E5 | Enumeration in `shared/domain.ts` only |
| `AI_TASKS` gains `write_variants`, `self_explain`, `teach_back`, `review_project`, `source_lesson`, `ask_to_question` | B4, C4, E1–E4 | Every one through `callStructured()` |
| `Answers.project_prompt` gains optional `evidence` | E4 | |

## 6. How to tell if it works

Measure the learning, not the feature count. Every figure below comes from
existing tables, and Insights (D4) shows them.

| Metric | Target |
|---|---|
| True retention (pass rate on items in `review`) | 0.85–0.92, around the 0.9 setting |
| Share right when *certain* | ≥ 90 % |
| Lapses per 100 reviews | falling month on month |
| Durable mastery of a goal's topics on its target date | ≥ 80 % |
| Reviews done ÷ reviews due, per week | ≥ 90 % |
| Confidently wrong in Practice | falling |

Take the baseline after Track A: A1–A3 change the numbers, so before/after
comparisons start there.

## 7. Build order (continues from step 23)

*Track A*

24. Retries unrated, scheduler rules version and replay (A1). Test with the F1
    scenario.
25. Durable mastery horizon, with recall now shown beside it (A2).
26. Rating rules v2 (A3); update the rating table in phase-2-3-plan.md.
27. Response time (A4) and shuffling at display (B1).

*Tracks B and D, no AI*

28. Re-study on a miss (B2) and mastery per concept (D5).
29. Today, review cap and forecast (D1); interleaved Practice (D2); session
    summary (D3).
30. Insights (D4) and goal readiness (D6). **Record the baseline.**

*Track C and the rest of B, prompt work*

31. Learner model in lesson context (C1). **Stop for review.**
32. `short_answer` with AI grading (B3). **Stop for review.**
33. Diagrams as data (C3): schema and grammar test first, then widgets.
    **Stop for review.**
34. Worked and faded examples (C2), own-words prompts (C4), pre-questions (C5).
35. Leeches → lesson patches from Optimise (B5).
36. Question variants (B4). **Stop for review.**

*Track E*

37. Own sources (E1) and Ask → question (E3).
38. Teach-back (E2), then synthesis (E5), projects (E4), adaptive placement
    (E6) and the phone (E7) as wanted.

## Non-goals

- No gamification for its own sake: no points, badges or leaderboards. A quiet
  "reviews kept up" record is fine; the number that matters is durable recall.
- No AI-written code in the app, diagrams included: C3 adds data-driven
  components.
- No auto-applied AI changes: variants, patches and map changes stay visible
  and reversible.
- Still no hand-entered mastery.

## Open questions

- **Horizon**: 30 days (proposed) or 7? With 30, *solid* needs at least one
  spaced review; with 7, a confident first day can count.
- **Guesses**: a lucky right guess as *Again* (proposed) or *Hard*?
- **Daily cap**: 60 reviews? Should Today hold back new lessons when the
  forecast is over the cap?
- **Variants**: appear directly, since you asked for them like Build lesson
  (proposed), or go through a proposal per lesson?
- **Phone**: local network only, or worth a token and a tunnel?

## References

- Roediger & Karpicke (2006). Test-enhanced learning. *Psychological Science*.
- Kang, McDermott & Roediger (2007). Test format and corrective feedback modify
  the effect of testing on long-term retention. *European Journal of Cognitive
  Psychology*.
- Cepeda et al. (2006). Distributed practice in verbal recall tasks.
  *Psychological Bulletin*.
- Rawson & Dunlosky (2011). Optimizing schedules of retrieval practice for
  durable and efficient learning. *Journal of Experimental Psychology: General*.
- Kornell & Bjork (2008). Learning concepts and categories: is spacing the
  "enemy of induction"? *Psychological Science*.
- Richland, Kornell & Kao (2009). The pretesting effect. *Journal of
  Experimental Psychology: Applied*.
- Dunlosky et al. (2013). Improving students' learning with effective learning
  techniques. *Psychological Science in the Public Interest*.
- Kalyuga, Ayres, Chandler & Sweller (2003). The expertise reversal effect.
  *Educational Psychologist*.
- Renkl & Atkinson (2003). Structuring the transition from example study to
  problem solving. *Educational Psychologist*.
- Mayer (2009). *Multimedia Learning*, 2nd edition.
- Butterfield & Metcalfe (2001). Errors committed with high confidence are
  hypercorrected. *Journal of Experimental Psychology: Learning, Memory, and
  Cognition*.
