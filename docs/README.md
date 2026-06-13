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
- **client/** — React 18 + Vite 6: shows liveness + lists ingested briefings.
- **client/src/useMeetingState.js** — `useMeetingState(slides)`: the page-gating state machine
  hook. Tracks `currentIndex`, `answers` (index → text, for `question` slides), and `decision`
  (`null` until resolved, then `{ outcome: 'approve'|'redirect', direction }`). Exposes
  `continue()` (advances `info` slides), `answer(text)` (records a non-empty answer and advances
  `question` slides), and `decide(outcome, direction)` (resolves the terminal `decision` slide
  without advancing). All gates no-op when not applicable; client state only, no server writes.
  Tested by `client/src/useMeetingState.test.js` against `briefings/sprint-1.json`
  (`cd client && npm test`, vitest + `@testing-library/react`).
- **scripts/poll.mjs** — local loop-closer stub (drains `/api/next-sprint`, not yet implemented).

Not yet built: meeting UI / slide stage, `/api/minutes`, `/api/next-sprint`, `/api/qa`, voice.
