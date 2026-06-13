# docs/

Confirmed current state of the codebase, maintained by the in-lane docs agents
(the `docs-maintainer` skill): current state only, no history notes. Together with
`minutes/` (direction) this is enough context for any new agent to orient.

## Current state (kickoff)

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
- **client/** — React 18 + Vite 6. The landing list shows liveness + lists ingested briefings.
- **client/src/MeetingView.jsx** — `MeetingView({ id })` page: fetches `GET /api/briefings/{id}`
  on mount (re-fetches on `id` change), renders a loading state (`data-testid="loading"`), an
  error state on non-2xx / network failure / missing `slides` (`data-testid="error"`, text
  "not found"), and on success the sprint header (`sprintId` + `goal`) plus `<SlideStage>`. It
  drives `useMeetingState(briefing.slides)` and wires its `currentIndex`/`answers`/`continue`/
  `answer`/`decide` into `SlideStage`. No writes — answers/decision live in client state only.
- **client/vitest.config.js** — Vitest (jsdom + globals). Run `cd client && npm test`.
  `client/src/__tests__/MeetingView.test.jsx` covers the fetch/loading/error/wiring behaviour
  against `briefings/sprint-1.json` (SlideStage + useMeetingState are mocked).
- **scripts/poll.mjs** — local loop-closer stub (drains `/api/next-sprint`, not yet implemented).

Not yet built: meeting UI / slide stage, `/api/minutes`, `/api/next-sprint`, `/api/qa`, voice.
