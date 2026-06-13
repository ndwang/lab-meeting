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
- **client/** — React 18 + Vite 6 SPA with hash-based client-side routing (no router dependency).
  - `src/main.jsx` mounts `src/Router.jsx`.
  - `src/Router.jsx` — reads `location.hash` on mount and on `hashchange`; dispatches `#/` (or
    empty hash) to `BriefingList` and `#/meeting/:id` to `MeetingView`; a non-integer meeting id
    redirects to `#/` and renders `BriefingList`.
  - `src/App.jsx` — default export `BriefingList`: fetches and lists briefings; each row is an
    `<a href="#/meeting/{id}">` link.
  - `src/MeetingView.jsx` — fetches `GET /api/briefings/:id`; renders a minimal meeting shell
    (loading/error states, slide count). Full page-gated slide stage is built in later lanes.
  - `src/__tests__/Router.test.jsx` — covers all routing paths (list, meeting, redirect on bad id,
    hashchange re-render, back link). Run with `cd client && npm test`.
  - `client/vitest.config.js` — Vitest config: jsdom environment, globals enabled, React plugin.
  - `client/package.json` test script: `vitest run`; devDependencies include `vitest`,
    `@testing-library/react`, `@testing-library/user-event`, `jsdom`.
  - The Router renders a `<a href="#/">← Back to briefings</a>` link above `MeetingView`.
- **scripts/poll.mjs** — local loop-closer stub (drains `/api/next-sprint`, not yet implemented).

Not yet built: full meeting UI / page-gated slide stage, `/api/minutes`, `/api/next-sprint`, `/api/qa`, voice.
