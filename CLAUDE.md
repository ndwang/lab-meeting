# CLAUDE.md — Lab Meeting

This is how the kickoff's understanding propagates to every future subagent. Read this first.

## What this is

A human-in-the-loop layer for long-horizon agents. Agents work in autonomous sprints
(dynamic workflows), then **report to their human like PhD students report to a PI: at a
lab meeting.** After each sprint a reporter agent compiles a briefing of structured slides,
posts it to the deployed meeting app, and requests a meeting. The human reviews by voice/text,
asks grounded follow-ups, and gives direction; that direction becomes the next sprint's input.
The full vision and rationale live in `initial_files/lab-meeting-design-doc.md` — read it.

## Master rules (apply to all work — agents included)

- **No backward compatibility, compatibility layers, or aliases** unless explicitly required.
  When not explicitly required, prefer a breaking change that keeps the implementation simpler
  and cleaner.
- **Remove historical traces.** Make the codebase read as if the new behavior had always existed —
  no "kept for compatibility" comments, no dead alternative paths.
- **No silent fallbacks or ad hoc alternative paths** unless explicitly requested.
- **Fail fast.** Avoid fallbacks by default. If safe continuation isn't possible, raise a clear
  error. Do not pass default fallback values to env/config lookups (e.g. no
  `process.env.X || default`) — require the variable and fail with a clear message if it's missing.

## Architecture (two systems, joined over HTTP — not the filesystem)

1. **Sprint runner (local, not deployed):** the `/sprint` dynamic workflow in Claude Code.
   Spawns planner → spec reviewer → parallel work lanes in worktrees → integrate/test →
   reporter. Only agents touch files and run commands.
2. **Meeting app (deployed — the live URL):** `server/` (Fastify API + serves the built
   `client/` SPA) and `client/` (React + Vite). One service, plus Postgres. Deployed on Render
   via `render.yaml`.

The integration point: **the reporter ends every sprint by `POST`ing the briefing JSON to
`/api/briefings`.** This replaces a watched directory and makes Lab Meeting a layer over *any*
workflow — "add one curl and your agents get a PI."

## The HTTP contract (stable — downstream depends on it)

- `POST /api/briefings` — reporter posts the briefing JSON. Bearer token. Returns `{ briefingId }`.
- `GET  /api/briefings`, `GET /api/briefings/:id` — read briefings back.
- `POST /api/minutes` — written when the human resolves the decision slide (Sprint 2).
- `GET  /api/next-sprint` — the local poller (`scripts/poll.mjs`) drains the queue (Sprint 2).
- `POST /api/qa` — server-side grounded Q&A via Opus 4.8 (Sprint 3).

All write/ingest endpoints require `Authorization: Bearer $LAB_MEETING_TOKEN`. Token is shared
between the server and the local runner. When unset (local dev), endpoints are open.

## Briefing / slide JSON schema (reporter emits; the app owns all rendering)

```jsonc
{
  "sprintId": "sprint-2",
  "goal": "short string",
  "slides": [
    {
      "type": "info" | "question" | "decision",
      "title": "string",
      "content": ["terse bullet", "terse bullet"],   // visual content, NOT prose
      "narration": "conversational TTS script for this slide"
    }
  ],
  "artifacts": {                  // grounding context for the Q&A agent — real, not vibes
    "specDeltas": "...", "gitLog": "...", "diffs": "...",
    "testOutput": "...", "docsChanged": "...", "reviewerVerdicts": "..."
  }
}
```
Slide protocol: **info** presents then auto-advances on silence; **question** hard-gates until
answered; **decision** closes the meeting, requires explicit Approve | Redirect, edits live on redirect.

## Conventions

- **Stack:** Node 20+ ESM, Fastify 5, React 18 + Vite 6, Postgres (`pg`). Single deployed service.
- **Storage:** `server/src/db.js` requires `DATABASE_URL` (Postgres). It fails fast if unset —
  no in-memory fallback. `server/src/app.js` exports `buildApp()` (routes only, no DB connect, no
  listen) so routes are testable via `app.inject()`; `server/src/index.js` connects the DB and
  listens. Required env (all fail fast if missing): `DATABASE_URL`, `LAB_MEETING_TOKEN`, `PORT`.
- **The server stamps `created_at`.** Agents/scripts must not rely on local clocks for ordering.
- **Specs are the contract.** Plan with `SPEC_TEMPLATE.md`; review per the `spec-review` skill;
  keep `docs/` current per the `docs-maintainer` skill (current state only, no history notes).
- **Skills** live in `.claude/skills/` and are auto-discoverable by every agent (including workflow
  subagents). Use `spec-review` and `docs-maintainer` in the relevant sprint phases.
- **Done is model-verifiable:** spec acceptance criteria + a test suite + a responding URL +
  `rubric.md`. Reviewers verify against the spec; integrate loops on tests until green.
- Completed specs move to `specs/archive/` (reporter source material + demo evidence), not deleted.
- Keep sprint goals narrow and concrete. Give each workflow phase a token budget and a hard stop.
- Route models by role: cheaper models for planner/reviewers; Opus 4.8 for builders, reporter, Q&A.

## Commands

- `npm run install:all` — install server + client deps
- `npm run build` — install all + build the client (what Render runs)
- `npm start` — run the server (serves API + built client); requires DATABASE_URL, LAB_MEETING_TOKEN, PORT
- `npm run dev:server` / `npm run dev:client` — local dev (client proxies /api to :3000)

## Build Day guardrails

- The live URL must always work. The text + slides + Q&A path must never depend on venue audio.
- "Dashboard as the main feature" is a *prohibited* category — this is an interactive control
  surface with decision gates, never frame or demo it as passive observability.
- Public repo, standalone/extractable, only what was built today. Keep the session log.
