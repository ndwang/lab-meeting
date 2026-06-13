# Lab Meeting

**A human-in-the-loop layer for long-horizon agents.** Agents work autonomously in sprints, then
report to their human the way PhD students report to a PI — at a lab meeting. After each sprint a
reporter agent compiles a briefing of structured slides, posts it to this app, and requests a
meeting. The human reviews by voice/text, asks grounded follow-ups, and gives direction; that
direction becomes the next sprint's marching orders. Minutes carry across sprints.

Built for Claude Build Day, 2026-06-13, with Opus 4.8.

## The brief

- **Problem:** as agents work autonomously for hours across hundreds of subagents, humans lose the
  thread. Dynamic workflows are fire-and-forget; Anthropic's docs say human sign-off between stages
  means chaining workflow runs — but nobody built the sign-off layer. This is that layer.
- **Who it's for:** anyone running long-horizon agentic work (programmers, auto-research) who needs
  to stay in command without reading logs nobody reads.
- **Done looks like:** a deployed URL where a real sprint's briefing is presented as a gated
  meeting, the human redirects on a decision slide, minutes are written, and the next sprint
  launches from those minutes — one full control loop, live.

## Architecture

Two systems joined over HTTP, not the filesystem:

- **Sprint runner (local):** the `/sprint` dynamic workflow in Claude Code. Ends by `POST`ing a
  briefing to `/api/briefings`.
- **Meeting app (deployed — this repo's `server/` + `client/`):** Fastify API that serves the
  built React/Vite SPA, backed by Postgres. The live URL.
- **Loop-closer (`scripts/poll.mjs`, local):** drains queued sprints and launches them headless.

See `CLAUDE.md` for the full HTTP contract + briefing schema, `rubric.md` for acceptance criteria,
and `initial_files/lab-meeting-design-doc.md` for the full design.

## Run locally

```bash
cp .env.example .env         # then fill in DATABASE_URL, LAB_MEETING_TOKEN, PORT
npm run install:all          # install server + client
npm run build                # build the client
npm start                    # serve API + client (fails fast if required env is missing)

# or, two terminals for hot reload:
npm run dev:server
npm run dev:client           # proxies /api to :3000
```

Smoke-test the ingest contract:

```bash
curl -s localhost:3000/api/health
curl -s -X POST localhost:3000/api/briefings -H 'content-type: application/json' \
  -d '{"sprintId":"sprint-0","goal":"smoke test","slides":[{"type":"info","title":"Hello","content":["it works"],"narration":"Hi."}]}'
curl -s localhost:3000/api/briefings
```

## Deploy (Render)

Push to GitHub, then **New → Blueprint** and point it at this repo. `render.yaml` provisions the
web service + Postgres and generates `LAB_MEETING_TOKEN`. Set `ANTHROPIC_API_KEY` in the dashboard.

## Status

Kickoff skeleton: deployable hello-world + ingest endpoint. Sprint 1 adds the meeting UI; Sprint 2
closes the loop; Sprint 3 adds grounded Q&A and voice; Sprint 4 adds the Zoom skin.
