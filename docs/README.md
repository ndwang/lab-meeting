# docs/

Confirmed current state of the codebase, maintained by the in-lane docs agents
(the `docs-maintainer` skill): current state only, no history notes. Together with
`minutes/` (direction) this is enough context for any new agent to orient.

## Current state

- **server/src/app.js** — `buildApp()`: Fastify routes (`GET /api/health`; `GET /api/version`
  returns `{ version }` read from the root `package.json` at module load, no DB/no auth;
  `POST /api/briefings` with bearer token, `GET /api/briefings[/:id]`) + built-client serving with
  SPA fallback. No DB connect, no listen, so routes are testable via `app.inject()`.
  Tested by `server/test/version.test.js` (`cd server && npm test`).
- **server/src/index.js** — entrypoint: requires `DATABASE_URL`, `LAB_MEETING_TOKEN`, `PORT`
  (fails fast if missing), connects the DB, then listens.
- **server/src/db.js** — Postgres via `pg`; requires `DATABASE_URL`, no fallback. Tables:
  `briefings`, `minutes`, `sprint_queue`.
- **server/src/env.js** — `requireEnv(name)`: fail-fast env lookup, no default values.
- **client/** — React 18 + Vite 6 SPA. `client/src/App.jsx` is currently the landing list:
  polls `/api/briefings` every 4 s and renders each briefing's `sprint_id` and `goal`. Routing
  and the meeting view are built in separate lanes.
- **client/src/SlideStage.jsx** — `SlideStage({ slides, currentIndex, answers, onContinue,
  onAnswer, onDecide })`: presentational component that renders one slide at a time — the
  title (`data-testid="slide-title"`), content bullets (`data-testid="slide-content"`),
  the presenter narration (`data-testid="slide-narration"`), and a "Slide N of M" progress
  indicator. Per-type controls: `info` shows a Continue button (`onContinue()`); `question`
  shows a textarea + Submit (disabled until non-empty, calls `onAnswer(trimmed)`); `decision`
  shows a direction textarea + Approve (`onDecide('approve','')`) and Redirect (disabled until
  non-empty, `onDecide('redirect', direction)`). Empty/out-of-range slides render a "No slide"
  placeholder; an unrecognised slide type renders content only and logs a `console.warn`. The
  component holds no data state and makes no fetch calls.
- **client/src/styles.css** — global styles plus `.slide-stage`, `.slide-progress`,
  `.slide-title`, `.slide-content`, `.slide-narration`, `.slide-controls`, and
  `.decision-actions` CSS classes used by `SlideStage`.
- **client tests** — Vitest (`environment: 'jsdom'`, `globals: true`) configured in
  `client/vitest.config.js`; run via `cd client && npm test`. `@testing-library/jest-dom`
  matchers loaded from `client/src/__tests__/setup.js`. `SlideStage` covered by
  `client/src/__tests__/SlideStage.test.jsx` (12 tests against `briefings/sprint-1.json`).
- **scripts/poll.mjs** — local loop-closer stub (drains `/api/next-sprint`, not yet implemented).

Not yet built: meeting view page + client routing, page-gating state machine, `/api/minutes`,
`/api/next-sprint`, `/api/qa`, voice.
