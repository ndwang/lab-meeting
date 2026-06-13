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
- **client/src/App.jsx** — React 18 + Vite 6 shell: shows liveness and lists ingested briefings
  (polls `/api/health` and `/api/briefings` every 4 s). No routing yet.
- **client/src/SlideStage.jsx** — presentational slide-stage component. Renders one slide at a
  time: `data-testid="slide-title"`, `data-testid="slide-content"` (bullet `<li>` list),
  `data-testid="slide-narration"`, progress indicator (`Slide N of M`), and type-specific controls:
  `info` → Continue button; `question` → textarea + Submit (disabled until non-empty); `decision`
  → direction textarea + Approve button + Redirect button (disabled until direction typed). All
  gate logic is delegated to callbacks; no internal state machine.
- **client/src/useMeetingState.js** — `useMeetingState(slides)` hook. Page-gating state machine:
  `continue()` advances only on `info` slides; `answer(text)` records and advances only on
  `question` slides (no-op on empty string); `decide(outcome, direction)` sets `decision` only on
  `decision` slides without advancing. Returns `{ currentIndex, answers, decision, continue,
  answer, decide }`. All captured data lives in client state only.
- **client testing** — Vitest (jsdom, `globals: true`) configured in `client/vitest.config.js`;
  run with `cd client && npm test` (`vitest run`). Tests live in `client/src/__tests__/`:
  `SlideStage.test.jsx` (renderer — 4 tests) and `useMeetingState.test.js` (state machine — 9
  tests), both driven by the real `briefings/sprint-1.json` fixture via relative import
  (`../../../briefings/sprint-1.json`). No browser, no running server required. Dev deps: `vitest
  ^2`, `@testing-library/react`, `@testing-library/user-event`, `jsdom`.
- **scripts/poll.mjs** — local loop-closer stub (drains `/api/next-sprint`, not yet implemented).

Not yet built: meeting view page + client-side routing (`/meeting/:id`), briefing links in the
landing list, `/api/minutes`, `/api/next-sprint`, `/api/qa`, voice/TTS.
