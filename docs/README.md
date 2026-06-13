# docs/

Confirmed current state of the codebase, maintained by the in-lane docs agents
(`skills/docs-maintainer.md`): current state only, no history notes. Together with
`minutes/` (direction) this is enough context for any new agent to orient.

## Current state (kickoff)

- **server/** — Fastify (ESM). `GET /api/health`, `POST /api/briefings` (bearer token),
  `GET /api/briefings[/:id]`. Serves the built client from `client/dist` with SPA fallback.
- **server/src/db.js** — Postgres via `pg` when `DATABASE_URL` is set; in-memory fallback
  otherwise. Tables: `briefings`, `minutes`, `sprint_queue`.
- **client/** — React 18 + Vite 6 hello-world: shows liveness + lists ingested briefings.
- **scripts/poll.mjs** — local loop-closer stub (drains `/api/next-sprint`, not yet implemented).

Not yet built: meeting UI / slide stage, `/api/minutes`, `/api/next-sprint`, `/api/qa`, voice.
