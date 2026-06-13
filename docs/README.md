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
  - `POST /api/minutes` — browser-facing, **no token**. Body `{ briefingId, outcome:
    'approve'|'redirect', directive, answers? }`. Persists a `minutes` row (outcome + full payload),
    then enqueues a `sprint_queue` row with `goal=directive` and a rendered `minutes` text (outcome,
    directive, any answers). Returns `{ minutesId, queuedSprintId }`. 400 if `briefingId`/`outcome`/
    `directive` missing or `outcome` invalid.
  - `GET /api/next-sprint` — **requires the bearer token** (the local poller). Atomically claims the
    oldest `pending` queued sprint (`UPDATE ... FOR UPDATE SKIP LOCKED`, marks it `consumed` so it
    drains exactly once) and returns `{ goal, minutes }`; `204` when none pending.
  - `requireToken(req, reply)` returns a plain boolean (`true` = rejected, 401 sent) so guards
    short-circuit with `if (requireToken(...)) return;` — it must NOT be awaited.
  Tested by `server/test/version.test.js` and `server/test/minutes.test.js` (`cd server && npm test`).
- **server/src/index.js** — entrypoint: requires `DATABASE_URL`, `LAB_MEETING_TOKEN`, `PORT`
  (fails fast if missing), connects the DB, then listens.
- **server/src/db.js** — Postgres via `pg`; requires `DATABASE_URL`, no fallback. Tables:
  `briefings`, `minutes`, `sprint_queue`. Functions: `insertBriefing`, `listBriefings`,
  `getBriefing`, `insertMinutes`, `enqueueSprint`, `claimNextSprint` (atomic claim of the oldest
  pending queued sprint).
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

Not yet built: `/api/qa`, voice/TTS/ASR.
