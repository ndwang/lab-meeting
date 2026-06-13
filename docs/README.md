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
- **client/src/App.jsx** — React 18 + Vite 6 landing shell: polls `GET /api/health` and
  `GET /api/briefings` every 4 s; lists ingested briefings by sprint id and goal. Hash-based
  routing and links to meeting views are delivered by the client-router lane.
- **client/src/MeetingView.jsx** — `MeetingView({ id })` page component: fetches
  `GET /api/briefings/{id}` on mount (re-fetches when `id` prop changes). Status machine:
  `'loading'` → shows `<p data-testid="loading">Loading…</p>`; `'error'` (non-2xx, network
  failure, or missing/non-array `slides`) → shows `<p data-testid="error">` containing "not
  found"; `'ok'` → renders a sprint header (`data-testid="sprint-header"`) with `sprintId`
  (`data-testid="sprint-id"`) and `goal` (`data-testid="goal"`), then calls
  `useMeetingState(briefing.slides)` and renders `<SlideStage slides currentIndex answers
  onContinue onAnswer onDecide>`. Makes no write calls — answers and the decision outcome live
  in client state only.
- **client/src/SlideStage.jsx** — placeholder stub (renders null); the real implementation is
  delivered by the slide-stage-renderer lane.
- **client/src/useMeetingState.js** — placeholder stub (minimal useState); the real hook is
  delivered by the meeting-state-machine lane.
- **client/vitest.config.js** — Vitest configured with jsdom environment and globals. Run
  `cd client && npm test` (alias: `vitest run`).
- **client/src/__tests__/MeetingView.test.jsx** — unit tests for `MeetingView`: loading
  indicator, fetch URL, sprint header + SlideStage render on success, prop wiring to SlideStage
  and useMeetingState, 404/network-error/malformed-payload error states, empty slides array,
  id-prop-change re-fetch, and no-write assertion. Uses `briefings/sprint-1.json` as fixture;
  mocks SlideStage and useMeetingState to isolate this lane.
- **scripts/poll.mjs** — local loop-closer stub (drains `/api/next-sprint`, not yet implemented).

Not yet built (other sprint-1 lanes): hash router + landing links (`client-router`),
`SlideStage` renderer (`slide-stage-renderer`), `useMeetingState` hook
(`meeting-state-machine`), client test harness wiring (`client-test-setup`).
Not yet built (later sprints): `/api/minutes`, `/api/next-sprint`, `/api/qa`, voice/TTS.
