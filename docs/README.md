# docs/

Confirmed current state of the codebase, maintained by the in-lane docs agents
(the `docs-maintainer` skill): current state only, no history notes. Together with
`minutes/` (direction) this is enough context for any new agent to orient.

## Current state

- **server/src/app.js** — `buildApp({ db } = {})`: Fastify routes + built-client serving with SPA
  fallback. No DB connect, no listen, so routes are testable via `app.inject()`. The `db` layer is
  injectable (defaults to the real `db.js` module) so DB-touching routes are testable without a live
  Postgres. Routes:
  - `GET /api/health`, `GET /api/version` — `{ version }` read from the root `package.json` at
    module load; no DB, no auth.
  - `POST /api/briefings` — bearer token; ingests a briefing. `GET /api/briefings[/:id]` — reads.
  - **Decision handoff** — a status machine on the `minutes` row
    (`resolved → composing → composed → approved`). Recording the human's decision is decoupled from
    enqueuing the next sprint: the human resolves the decision slide, a host agent composes the next
    instruction, the human approves it, and only then is a sprint queued. The server holds no LLM —
    it is the state-machine bus.
    - `POST /api/minutes` — browser-facing, **no token**. Body `{ briefingId, outcome:
      'approve'|'redirect', directive, answers? }`. Inserts a `minutes` row with `status='resolved'`
      via `db.insertMinutes` (dedicated `directive`/`answers` columns; `answers` defaults to `[]`).
      Does NOT enqueue. Returns `201 { minutesId }`. `400` if `briefingId`/`outcome`/`directive`
      missing or `outcome` invalid.
    - `GET /api/compose/pending` — **requires the bearer token** (the attendant daemon). Atomically
      claims the oldest `resolved` row (`db.claimPendingCompose`, marks it `composing`) and returns
      `200 { minutesId, briefingId, outcome, directive, answers }`; `204` when none pending.
    - `POST /api/minutes/:id/instruction` — **requires the bearer token** (the host agent). Body
      `{ goal, minutesText }`. Sets `composed_goal`/`composed_minutes` and advances the row to
      `composed` via `db.setComposed`. Returns `200 { ok: true }`; `404` if the id is unknown;
      `400` if `goal` or `minutesText` is missing.
    - `GET /api/minutes?briefingId=N` — browser-facing, **no token**. Returns the minutes record(s)
      for the briefing `[{ id, status, outcome, directive, composedGoal, composedMinutes, created_at }]`
      via `db.getMinutesForBriefing` (oldest-first) so the client can poll for the composed
      instruction. `400` if `briefingId` is absent or not a valid integer. Registered before the
      `/api/minutes/:id` POST routes.
    - `POST /api/minutes/:id/approve` — browser-facing, **no token**. Body `{ goal? }` (the
      possibly-edited instruction). Enqueues `sprint_queue(goal = provided goal else composed_goal,
      minutes = composed_minutes)` and advances the row to `approved` via `db.approveMinutes`.
      Returns `201 { queuedSprintId }`; `409` if the row is not yet `composed`; `404` if the id is
      unknown (discriminated on the db error message: "not composed" → 409, "not found" → 404).
  - `GET /api/next-sprint` — **requires the bearer token** (the local poller). Atomically claims the
    oldest `pending` queued sprint (`UPDATE ... FOR UPDATE SKIP LOCKED`, marks it `consumed` so it
    drains exactly once) and returns `{ goal, minutes }`; `204` when none pending.
  - **Q&A channel** — store-and-forward relay; the server holds no LLM:
    - `POST /api/qa` — browser-facing, **no token**. Body `{ briefingId, question }`. Inserts a
      pending `qa` row via `db.insertQuestion`. Returns `201 { questionId }`. `400` if `briefingId`
      is missing/null or `question` is missing/empty.
    - `GET /api/qa?briefingId=N` — browser-facing, **no token**. Returns the full Q&A thread
      `[{ id, question, answer, status, created_at }]` (oldest-first) via `db.listQAForBriefing`.
      `400` if `briefingId` is absent or not a valid integer (never passes `undefined` to the db).
    - `GET /api/qa/pending` — **requires the bearer token** (the attendant daemon). Atomically claims
      the oldest `pending` question (`db.claimPendingQuestion`, marks it `claimed`) and returns
      `200 { id, briefingId, question }`; `204` when none pending.
    - `POST /api/qa/:id/answer` — **requires the bearer token**. Body `{ answer }`. Sets the answer
      and marks the row `answered` via `db.answerQuestion`. Returns `200 { ok: true }`; `404` if the
      id is unknown; `400` if `answer` is missing/empty.
  - `requireToken(req, reply)` returns a plain boolean (`true` = rejected, 401 sent) so guards
    short-circuit with `if (requireToken(...)) return;` — it must NOT be awaited.
  Tested by `server/test/version.test.js`, `server/test/minutes.test.js`,
  `server/test/qa.db.test.js` (the Q&A storage functions), and
  `server/test/qa.routes.test.js` (the Q&A routes) (`cd server && npm test`).
- **server/src/index.js** — entrypoint: requires `DATABASE_URL`, `LAB_MEETING_TOKEN`, `PORT`
  (fails fast if missing), connects the DB, then listens.
- **server/src/db.js** — Postgres via `pg`; requires `DATABASE_URL`, no fallback. Tables:
  `briefings`, `minutes`, `sprint_queue`, `qa`. Functions: `insertBriefing`, `listBriefings`,
  `getBriefing`, `insertMinutes`, `enqueueSprint`, `claimNextSprint` (atomic claim of the oldest
  pending queued sprint). Q&A channel functions: `insertQuestion({ briefingId, question })` inserts
  a `pending` `qa` row and returns its id; `claimPendingQuestion()` atomically claims the oldest
  `pending` question (`UPDATE ... FOR UPDATE SKIP LOCKED`, marks it `claimed`) and returns
  `{ id, briefingId, question }` or `null` when none pending; `answerQuestion({ id, answer })` sets
  the answer and marks the row `answered`, returning `true` if a row matched else `false`;
  `listQAForBriefing(briefingId)` returns the thread `[{ id, question, answer, status, created_at }]`
  oldest-first. The `qa` table: `id`, `briefing_id` (FK → briefings), `question`, nullable `answer`,
  `status` (`pending`|`claimed`|`answered`, default `pending`), server-stamped `created_at`.
- **server/src/env.js** — `requireEnv(name)`: fail-fast env lookup, no default values.
- **client/** — React 18 + Vite 6 SPA with hash-based client-side routing (no router dependency).
  - `src/main.jsx` mounts `src/Router.jsx`.
  - `src/Router.jsx` — reads `location.hash` on mount and on `hashchange`; dispatches `#/` (or
    empty hash) to `BriefingList` and `#/meeting/:id` to `MeetingView`; a non-integer meeting id
    redirects to `#/` and renders `BriefingList`. Renders a `← Back to briefings` link above the
    meeting view.
  - `src/App.jsx` — default export `BriefingList`: polls `/api/briefings` and lists briefings;
    each row is an `<a href="#/meeting/{id}">` link.
  - `src/MeetingView.jsx` — fetches `GET /api/briefings/:id` (loading/error/ok states), renders
    the sprint header (sprint id + goal), and drives the slide stage via `useMeetingState`. When the
    human resolves the decision slide, an effect watching `state.decision` `POST`s
    `/api/minutes` exactly once (guarded by a ref against StrictMode double-invoke) with
    `{ briefingId, outcome, directive, answers }`, where `answers` is derived from `state.answers`
    against `briefing.slides`. `submitStatus` (`null`/`pending`/`confirmed`/`error`) drives the UI:
    on 201 it replaces the stage with a `minutes-confirmed` banner ("Minutes recorded · next sprint
    queued"); on any non-201/network error it shows a `minutes-error` banner with a `minutes-retry`
    button that resets `submitStatus` to `null` so the human can re-click Approve/Redirect.
    The slide stage and the Q&A panel render side by side inside a `meeting-stage` wrapper, so the
    live Q&A aside is available throughout the meeting regardless of the current slide.
- **client/src/QAPanel.jsx** — default export `QAPanel({ briefingId })`: the live Q&A aside.
  Renders a "Ask a follow-up" textarea + Ask button (disabled while empty or while a POST is in
  flight) and the running Q&A thread. On submit it `POST`s `/api/qa` (browser-facing, **no token**)
  with `{ briefingId, question }`, optimistically appends the question to the thread in a
  "pending — bringing in the engineer…" state, and clears the textarea. It polls
  `GET /api/qa?briefingId=N` every 3s while any thread item is unanswered, replacing the thread with
  each response; once the daemon-spawned host agent answers (`status === 'answered'`), the answer
  renders attributed to "Claude — Engineer" and, when all items are answered, polling stops. The
  interval is cleared on unmount. Each question shows a "You" label; a failed POST shows an inline
  `qa-error` and re-enables the form without adding the question to the thread. Poll failures are
  silent. Holds no slide state and never touches the slide-gating flow.
- **client/src/SlideStage.jsx** — default export `SlideStage({ slides, currentIndex, answers,
  onContinue, onAnswer, onDecide })`: presentational component that renders one slide at a time —
  the title (`data-testid="slide-title"`), content bullets (`data-testid="slide-content"`),
  the presenter narration (`data-testid="slide-narration"`), and a "Slide N of M" progress
  indicator. Per-type controls: `info` shows a Continue button (`onContinue()`); `question`
  shows a textarea + Submit (disabled until non-empty, calls `onAnswer(trimmed)`); `decision`
  shows a direction textarea + Approve and Redirect. Approve calls
  `onDecide('approve', slide.content.join('\n'))` — adopting the briefing's proposed next-steps as
  the directive; Redirect (disabled until non-empty) calls `onDecide('redirect', direction)`.
  Empty/out-of-range slides render a "No slide"
  placeholder; an unrecognised slide type renders content only and logs a `console.warn`. The
  component holds no data state and makes no fetch calls.
- **client/src/useMeetingState.js** — `useMeetingState(slides)`: the page-gating state machine.
  Returns `{ currentIndex, answers, decision, continue, answer, decide }`. `info` advances via
  `continue()`; `question` hard-gates until a non-empty `answer(text)` (recorded by index);
  `decision` is terminal — `decide(outcome, direction)` records the outcome without advancing.
  Captured answers/decision live in client state; `MeetingView` reads `decision` to POST the minutes.
- **client/src/styles.css** — global styles plus `.back`, `.slide-stage`, `.slide-progress`,
  `.slide-title`, `.slide-content`, `.slide-narration`, `.slide-controls`, `.decision-actions`,
  and the `.meeting-stage` / `.qa-*` (panel, thread, item, question, answer, author, pending,
  form, error) CSS classes for the Q&A aside.
- **client tests** — Vitest (`environment: 'jsdom'`, `globals: true`) configured in
  `client/vitest.config.js`; `@testing-library/jest-dom` matchers loaded from
  `client/src/__tests__/setup.js`. Run via `cd client && npm test`. Coverage:
  `Router.test.jsx`, `MeetingView.test.jsx`, `__tests__/SlideStage.test.jsx`,
  `useMeetingState.test.js` (exercised against `briefings/sprint-1.json`), and `QAPanel.test.jsx`
  (mocked fetch + fake timers covering POST, pending state, polled answer, textarea clear, polling
  stop, and POST-error handling).
- **scripts/poll.mjs** — local loop-closer: polls `GET /api/next-sprint` (bearer token required) and
  drains the queue, launching the next sprint when a queued row is available; owned by the sprint runner.

Not yet built: voice/TTS/ASR.
