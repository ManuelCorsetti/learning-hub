# Learning Studio

A personal learning map. You keep track of what you want to learn, Claude helps
capture, group and order it, and every AI change waits for your approval.
Status comes from measurement, not from what you type in: lessons test you, and
your answers drive a spaced-repetition scheduler (FSRS) that measures mastery.

- [docs/phase-1-plan.md](docs/phase-1-plan.md): what is built now, and why
- [docs/data-model.md](docs/data-model.md): conceptual, logical and physical data model
- [docs/phase-2-3-plan.md](docs/phase-2-3-plan.md): lessons, spaced repetition, co-authoring

## Run locally

Needs Node 22 or later.

```bash
npm install
npm run dev
```

Then open <http://localhost:5173>. The API runs on port 8787, and Vite proxies `/api` to it.

On first start the app creates `data/learning-studio.db` and loads a small
starter map: three areas, plus the four v0.1 articles as backlog topics. The
dimensional-modelling article is imported as a lesson (text only, no questions yet).

**AI features** (Capture, Organise, Build lesson, the "why" lines on Next up) need an
Anthropic API key. Set `ANTHROPIC_API_KEY` in your shell, or copy `.env.example`
to `.env`. Without a key everything else works and the AI buttons are disabled.
The default model is `claude-opus-5-5`; set `LEARNING_MODEL` to change it.

## Try it

1. **Capture**: paste a messy brain-dump on the home page. Try the one in
   `seed/sample-brain-dump.txt`.
2. **Review**: accept or reject each suggestion, or accept a whole run. A topic
   in a new area is applied after its area.
3. **Organise**: Claude suggests links (prerequisites first), moves and merges
   across the map.
4. Open an area and switch between **List** and **Graph**. Click a topic for its
   panel: status override, links, goals, resources and history.
5. Add a **goal** and link topics to it. They move up in **Next up**.
6. In a topic's panel, **Build lesson**: Claude writes a lesson with questions.
   For the imported dimensional-modelling lesson, use **Add questions** on the
   lesson page instead.
7. Answer the questions. Pick how sure you are before the answer is revealed;
   that sets the scheduler rating. Mastery and status update from your answers.
8. **Practice** lists every review that is due, across all topics.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | API (restarts on change) and Vite dev server |
| `npm run build` then `npm start` | Build the UI and serve it from the API on port 8787 |
| `npm test` | Backend tests (Vitest, in-memory database) |
| `npm run typecheck` | TypeScript across `backend`, `frontend` and `shared` |
| `npm run ai:smoke` | Run Capture on the sample brain-dump against a throwaway database and print the suggestions (calls the API) |
| `npm run ai:lesson` | Generate a lesson in a throwaway database and print it for prompt review (calls the API). Pass a topic title, or `--questions` for the imported article |
| `npm run db:reset` | Delete the local database and reload the starter map |
| `npm run db:replay` | Rebuild every review schedule by replaying attempts (after changing scheduler parameters) |

Every Claude call is logged in the `ai_runs` table, including the prompt hash,
each attempt's raw output and validation errors, and token counts. Use that log
when tuning the prompts in `prompts/`.
