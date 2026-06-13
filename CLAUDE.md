# CLAUDE.md — Lab Meeting

This is how the kickoff's understanding propagates to every future subagent. Read this first.
The judge-facing brief and full vision live in `README.md`.

## What this is

A **communication layer + meeting format + audio interface** for long-horizon agents — not a host
of agents. Agents already ping their owners over Slack/Discord MCP, but those are unstructured
interrupts. Lab Meeting gives them the oldest human-in-the-loop protocol there is: agents report to
their human the way PhD students report to a PI, at a **lab meeting**. After a work sprint an agent
posts a structured briefing; the human reviews it as a page-gated, voice-driven meeting, asks
follow-ups answered live and grounded in the real work, and gives direction; that direction becomes
the next sprint's marching orders. We provide the room, the format, and the voice — the agent runs
wherever it already runs.

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

## Architecture: the meeting room and the lab

- **The deployed meeting app (the live URL) is the meeting room.** It stores briefings/minutes,
  renders the meeting (slides + voice), and relays questions and answers. It holds **no LLM and no
  API key** — it is a message bus + UI. `server/` (Fastify API + serves the built `client/` SPA) and
  `client/` (React + Vite), one service plus Postgres, deployed on Render via `render.yaml`.
- **The lab is local** — the agent's machine, where work actually happens. `scripts/poll.mjs` is the
  **attendant daemon**: the lab's standing presence (assume it's running whenever a meeting happens).
  It launches queued sprints and, during a meeting, spawns the host agent.
- **Agents are ephemeral; artifacts are the baton.** The handoff chain:
  1. **Reporter** (last phase of a sprint) writes the **briefing artifact** (slides + grounding
     payload), `POST`s it, and exits.
  2. **Attendant daemon** sees the human open the meeting and spawns a **host agent** for it,
     grounded in that briefing artifact + the live repo.
  3. **Host agent** answers the human's questions live during the meeting; at meeting end it
     composes the **minutes** (decisions, deferred items, preferences) and the **next sprint
     instruction** from the human's redirect.
  4. The composed instruction is shown back on the decision slide; the **human approves** it (the
     visible "here's what I'll do next" beat), and the **daemon launches** the next sprint. One
     persistent launcher (daemon); ephemeral composers (host).
- **Two integration tiers:** "add one curl" → async briefings + minutes (no live Q&A); "run the
  attendant daemon / be a long-horizon agent on the MCP tools" → live, grounded Q&A. The MCP server
  (planned) wraps the contract so any MCP-capable agent plugs in natively.

## The HTTP contract

- `POST /api/briefings` — reporter posts the briefing JSON. Bearer token. Returns `{ briefingId }`. ✅
- `GET  /api/briefings`, `GET /api/briefings/:id` — read briefings back. ✅
- `POST /api/minutes` — **browser-facing, no token**: records the human's decision (outcome +
  direction). ✅ *(Being refactored: enqueue moves out of here; the host agent composes the next
  instruction, the human approves it, and only then is it enqueued.)*
- `GET  /api/next-sprint` — **bearer token**: the attendant daemon atomically drains the oldest
  queued sprint and launches it headless. ✅
- Q&A channel *(planned)*: `POST /api/qa` (browser posts a question, no token) → `GET /api/qa/pending`
  (host claims, token) → `POST /api/qa/:id/answer` (host posts, token) → browser polls for the answer.
- Next-instruction handoff *(planned)*: the host posts the composed minutes + proposed next
  instruction; the human approves; it is enqueued for the daemon.

Token rule: agent/daemon endpoints (`/api/briefings` POST, `/api/next-sprint`, Q&A `pending`/`answer`)
require `Authorization: Bearer $LAB_MEETING_TOKEN`; browser-facing human actions (`/api/minutes`,
posting a question) are open. The token is shared between the server and the local lab.

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
  "artifacts": {        // grounding context the host agent reads to answer Q&A — real, not vibes
    "specDeltas": "...", "gitLog": "...", "diffs": "...",
    "testOutput": "...", "docsChanged": "...", "reviewerVerdicts": "..."
  }
}
```
Slide protocol: **info** presents then auto-advances on silence; **question** hard-gates until
answered; **decision** closes the meeting — the human redirects, the host agent composes the next
instruction, it shows live on the slide, and the human Approves before it launches.

## Conventions

- **Stack:** Node 20+ ESM, Fastify 5, React 18 + Vite 6, Postgres (`pg`). Single deployed service.
  Voice is **client-side** (browser Web Speech API: TTS narration + push-to-talk ASR) — no key, runs
  on the deployed URL, text path always works as fallback.
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
- Route models by role: cheaper models for planner/reviewers; Opus 4.8 for builders, reporter, and
  the host agent.

## Commands

- `npm run install:all` — install server + client deps
- `npm run build` — install all + build the client (what Render runs)
- `npm start` — run the server (serves API + built client); requires DATABASE_URL, LAB_MEETING_TOKEN, PORT
- `npm run dev:server` / `npm run dev:client` — local dev (client proxies /api to :3000)
- `node --env-file=.env scripts/poll.mjs` — run the local attendant daemon (drains/launches sprints)

## Build Day guardrails

- The live URL must always work. The text + slides path must never depend on venue audio; voice is
  an enhancement over a flow that works in text.
- "Dashboard as the main feature" is a *prohibited* category — this is an interactive control
  surface with decision gates, never frame or demo it as passive observability.
- Public repo, standalone/extractable, only what was built today. Keep the session log.
