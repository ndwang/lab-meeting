# Lab Meeting

**A communication layer, a meeting format, and a voice — so you can stay in command of
long-horizon agents.** Agents already ping their owners over Slack/Discord, but those are
unstructured interrupts. Lab Meeting gives them the oldest human-in-the-loop protocol there is:
agents report to their human the way PhD students report to a PI — at a **lab meeting**. After a
work sprint, an agent posts a structured briefing; the human reviews it as a page-gated,
voice-driven meeting, asks follow-ups answered live and grounded in the real work, and gives
direction; that direction becomes the next sprint's marching orders. Minutes carry across sprints.

We don't host your agents. We provide the room, the format, and the voice — your agent runs
wherever it already runs.

Built for Claude Build Day, 2026-06-13, with Opus 4.8.

## The brief

- **Problem:** as agents work autonomously for hours across hundreds of subagents, humans lose the
  thread. Dynamic workflows are fire-and-forget; the answer so far is logs and dashboards nobody
  reads. The bottleneck is shifting from "can the agent do it" to "can the human stay in command."
- **Who it's for:** anyone running long-horizon agentic work (programmers, auto-research) who needs
  to direct it without babysitting it.
- **Done looks like:** a deployed URL where a real sprint's briefing is presented as a gated,
  spoken meeting; the human asks a question and an agent answers live from the actual code; the
  human redirects; that redirect becomes the next sprint's instruction and it launches — one full
  control loop, live.

## The two things we provide

1. **A meeting format** — a briefing as structured slides (`info` / `question` / `decision`), with
   turn-taking, hard gates on questions, a closing decision, and minutes that carry across sprints.
   The cadence, format, and power-dynamic of a lab meeting, as a protocol.
2. **An audio interface** — slides are spoken (TTS) and the human answers by push-to-talk (ASR), so
   it *feels* like a meeting, not a chat log. Browser-native, with a text path that always works.

## Architecture: the meeting room and the lab

The deployed app is the **meeting room**; your machine is the **lab** where agents run. They're
joined over HTTP — the app holds no LLM and no API key, it's a message bus + UI.

- **Meeting app (deployed — `server/` + `client/`):** Fastify API serving a React/Vite SPA, backed
  by Postgres. Stores briefings/minutes, renders the meeting, relays questions/answers. The live URL.
- **The lab (local):** `scripts/poll.mjs` is the **attendant daemon** — the lab's standing presence.
  It launches queued sprints and, during a meeting, spawns an ephemeral **host agent** to field Q&A.
- **The handoff (agents are ephemeral; artifacts are the baton):**

```
sprint reporter ──POST /api/briefings──▶ meeting room
   human opens the meeting ──▶ attendant daemon spawns a HOST AGENT (briefing + live repo)
      human asks ◀──live grounded Q&A──▶ host agent
      human redirects ──▶ host agent composes minutes + the next instruction
         ──▶ shown back on the decision slide ──▶ human APPROVES
            ──▶ attendant daemon launches the next sprint (minutes injected)
```

The host agent is spawned fresh per meeting, briefed by the artifact and live on the repo — so Q&A
is grounded in the real code, including the honest "that wasn't tested." The persistent daemon is
the only launcher; the ephemeral host is the composer.

**Two integration tiers:** *add one curl* (a workflow `POST`s a briefing) → async briefings +
minutes; *run the attendant daemon, or be a long-horizon agent on the MCP tools* → live grounded
Q&A. The `/sprint` dynamic workflow in this repo is our own dogfood example of a consumer — the
agents that build Lab Meeting report their progress through it.

See `CLAUDE.md` for the full HTTP contract + briefing schema, and `rubric.md` for acceptance criteria.

## Run locally

```bash
cp .env.example .env         # fill in DATABASE_URL, LAB_MEETING_TOKEN, PORT
npm run install:all          # install server + client
npm run build                # build the client
npm start                    # serve API + client (fails fast if required env is missing)

# or, two terminals for hot reload:
npm run dev:server
npm run dev:client           # proxies /api to :3000

# the local lab daemon (launches queued sprints, hosts Q&A):
node --env-file=.env scripts/poll.mjs
```

## Deploy (Render)

Push to GitHub, then **New → Blueprint** at the repo. `render.yaml` provisions the web service +
Postgres and generates `LAB_MEETING_TOKEN`. No API key needed on the server — it holds no LLM.

## Status

- **Built & live:** deployed meeting app; briefing ingest; the meeting view (page-gated slides +
  decision); `POST /api/minutes` + `GET /api/next-sprint`; the attendant daemon launching the next
  sprint headless — the full control loop, proven end to end on the live URL.
- **Next:** live grounded Q&A (daemon spawns the host agent), host-composed next instruction with
  the visible approval beat, client-side voice (TTS + push-to-talk ASR), and an MCP server so any
  MCP-capable agent plugs in natively.
