# Lab Meeting — a human-in-the-loop layer for long-horizon agents

*Working name; alternatives: Group Meeting, PI Mode, Readout. One-day build for Claude Build Day, June 13, 2026 — Opus 4.8.*

*Companion files: `SPEC_TEMPLATE.md` (the trimmed spec template the planner uses), `skills/spec-review.md` (review conventions), `skills/docs-maintainer.md` (docs conventions).*

## The problem

Opus 4.8 and Claude Code's dynamic workflows let agents work autonomously for hours, spawning dozens to hundreds of subagents per run. The better this gets, the worse a second problem gets: humans lose the thread. Programmers report not knowing what's in their own codebase anymore; researchers running auto-research can't tell whether the agent is still pointed at the right question. The bottleneck of agentic work is shifting from "can the agent do it" to "can the human stay in command of it."

Today's answer is logs and dashboards — passive observability that nobody reads. Dynamic workflows are explicitly fire-and-forget: they accept no mid-run user input, and Anthropic's own docs advise running each stage as its own workflow when you need sign-off between stages. Nobody has built the sign-off layer. That's the gap this project fills.

## The idea

Agents report to their human the way PhD students report to their PI: at group meetings. After each work sprint, the agents prepare a presentation, deliver it by voice, field follow-up questions grounded in their actual work, and take direction. The human's feedback becomes the marching orders for the next sprint. Everything is automatically documented into persistent meeting minutes that carry across sprints.

The metaphor is load-bearing, not decorative. It dictates the cadence (scheduled check-ins, not a firehose), the format (a structured briefing with claims, evidence, blockers, and proposals — not a diff), and the power dynamic (the human sets direction and allocates effort; the agents defend their choices). It also makes the product fun: agents presenting their work to a skeptical boss is inherently entertaining, and "I gave my agents a lab meeting" is the line that travels.

## How it maps onto dynamic workflows

Dynamic workflows already have the structure of a research group. The workflow script is the lab's operating procedure; the spawned subagents are the students; the missing role is the PI. The product is a chain of workflow runs gated by meetings.

A sprint is one dynamic workflow run, built from a single reusable template saved as `/sprint` and invoked with two arguments: the sprint goal and the latest meeting minutes. The final phase of every sprint is a reporter agent that compiles the briefing as structured slides. The meeting app receives new briefings; when one lands, the agents request a meeting. The human meets now or schedules for later; the meeting happens, minutes are written, and the human's directives launch the next sprint with the minutes passed in. Spoken feedback visibly becomes the next workflow's instructions — the control loop closed.

Because the integration point is just "workflows that end with a reporter phase," this works as a layer over any dynamic workflow, which is the generality claim of the product.

---

## Build Day constraint: this must ship to a live URL (and reshapes the architecture)

Claude Build Day requires a **live, deployed URL** that holds up in front of judges (Round 1 is async: judges click the link and browse the public repo; Round 2 top-6 is a 3-min live stage demo + Q&A). The original conception was laptop-local: a filesystem-watched briefings directory, git worktrees, shelling out to headless Claude Code, resume-within-session. None of that deploys.

**Resolution: split the system in two and connect them over HTTP, not the filesystem.**

1. **Sprint runner — stays local.** The `/sprint` dynamic workflow runs in Claude Code on the laptop (planner → spec review → parallel work lanes in worktrees → integrate/test → reporter). It is inherently a dev-machine thing; we do not deploy it. It is also where the genuine "it built itself" artifacts come from, which is the heart of the demo.
2. **Meeting app — deployed, this is the live URL.** Zoom-like meeting UI, slide rendering, page-gated flow, decision gates, minutes, grounded Q&A (server-side Opus 4.8), and an **HTTP ingest endpoint** that replaces the watched directory.

The one design change that unlocks deployment: **the watched briefings directory becomes `POST /api/briefings` on the deployed app.** The reporter agent already has Bash + network access, so each sprint ends with a `curl` of the briefing JSON to the live URL. This is not a hack — it is a better, more general design: *"add one curl to the end of any workflow and your agents get a PI."* That is a platform-shaped Impact claim, not a script. The deliverable is the `/sprint` workflow template plus the deployed meeting app; saved to `.claude/workflows`, any project gains a PI.

### Decisions locked (planning session, 2026-06-13)

- **Architecture:** local runner + deployed front-of-house, joined over HTTP.
- **Team:** solo. Scope cut accordingly (see build order).
- **Voice:** text-first. Ship rock-solid text + slides + Q&A that always works live; voice (TTS + push-to-talk ASR) is upside, added only after the loop is closed. Recorded fallback for the stage.
- **Stack:** single persistent Node server + Postgres on Render (or Fly). The server holds the Anthropic API key (for Q&A), serves a React+Vite SPA, and uses websockets (socket.io) for live turn-taking. One repo, one deployed service, one DB — minimal moving parts for solo.

### The HTTP contract (the new integration point — pin this in the kickoff)

All endpoints sit behind a shared bearer token in `Authorization` so random POSTs can't inject briefings. The token lives in an env var on both the server and the local runner.

- `POST /api/briefings` — body is the briefing JSON (schema below). The reporter agent posts here at the end of every sprint. Returns `{ briefingId }`. **This replaces the watched directory.**
- `POST /api/minutes` — written when the human resolves the decision slide. Body carries the outcome (approve/redirect), the directive text, and answers to any question slides. Server renders minutes markdown, stores it, and enqueues the next sprint.
- `GET /api/next-sprint` — the **local poller** hits this. Returns `{ goal, minutes }` if a sprint is queued (and marks it consumed), else 204. The poller is a ~30-line laptop script that, on a pending sprint, runs `claude -p "/sprint <goal> <minutes>"` headless. This closes the loop: typed/spoken redirect → minutes in the DB → next workflow launches. The laptop is on stage anyway; the URL stays independently real for remote judges.
- `POST /api/qa` — `{ briefingId, question }` → server calls Opus 4.8 with that briefing's **artifacts payload** as grounding context, streams back a grounded answer (including the honest "no, that wasn't tested — want me to?"). Stream over websocket/SSE.

### Briefing JSON schema (reporter emits this; the app owns all rendering)

```jsonc
{
  "sprintId": "sprint-2",
  "goal": "Close the loop: minutes -> next sprint",
  "createdAt": "<stamped by server, not the agent>",
  "slides": [
    {
      "type": "info" | "question" | "decision",
      "title": "string",
      "content": ["terse bullet", "terse bullet"],   // visual content, NOT prose
      "narration": "conversational TTS script for this slide"
      // question slides: what input is needed + why it escalated
      // decision slides: proposed next steps; require explicit Approve | Redirect
    }
  ],
  "artifacts": {
    // grounding context for the Q&A agent -- real, not summary vibes
    "specDeltas": "spec-vs-implementation deltas",
    "gitLog": "string",
    "diffs": "truncated unified diffs",
    "testOutput": "string",
    "docsChanged": "summary",
    "reviewerVerdicts": "pass/fail incl. failed attempts and reasons"
  }
}
```

---

## The sprint workflow

The `/sprint` template runs seven phases. The script holds the loop, the variables, and the spawn calls; only agents touch files and run commands.

**1. Planner.** One agent receives the sprint goal, the latest minutes, and CLAUDE.md, decomposes the goal into three to six work items, and writes a spec file per item following `SPEC_TEMPLATE.md` — purpose, acceptance criteria, target files, modules, data models, test cases. Specs are the contract everything downstream verifies against.

**2. Spec reviewer.** A single agent critiques all of the sprint's specs in one batch — checking each spec internally and checking the set against each other, especially for overlapping file claims between items that will collide at merge. The planner revises; maximum two review rounds, then the workflow proceeds. Reviewing the batch together is deliberate: cross-spec conflicts are exactly what per-spec review misses.

**3–5. Work lanes, parallel per item, each in an isolated worktree.** A builder implements its spec with a clean context containing only the spec, the minutes, and CLAUDE.md. An implementation reviewer — separate agent, fresh context, skeptic persona — diffs the worktree against the spec section by section and returns pass or fail with reasons; on fail the builder retries with the objections attached, capped at two retries before the item is flagged unresolved. If review suggests the spec itself was wrong — weakening an implemented contract — that is never resolved in the lane: it escalates to a question slide, because contract changes are PI decisions. Once review passes, a docs maintainer updates `docs/` inside that same worktree to reflect the new confirmed state, following `skills/docs-maintainer.md`: rewrite stale sections, current state only, no history notes. Each work item exits its lane fully done — implemented, verified, documented.

**6. Integrate and test.** A single agent merges the worktrees — code and docs together — resolves conflicts, runs a docs consistency pass so merged docs don't contradict each other, and loops on the test suite until green or a budget cap.

**7. Reporter.** The script has accumulated every agent's result in variables throughout the run; it passes all of it — planner output, spec review rounds, builder summaries, reviewer verdicts including failed attempts, docs changes, test results — into the reporter's prompt, and the reporter additionally reads the git log and diffs. It writes the briefing as structured slides (spec-versus-implementation deltas, a docs-changed summary, unresolved items as question slides, a proposed-next-steps decision slide) plus the `artifacts` grounding payload, and **`POST`s the whole briefing JSON to the deployed app's `/api/briefings`.** A meeting is requested.

The meeting is the gate between sprints: the human approves or redirects, minutes are written, the next sprint launches with the minutes as input. Completed specs move to `specs/archive/` rather than being deleted — they are reporter source material, meeting evidence, and demo artifacts.

Two efficiency notes. Route models by role in the script: reviewers and the planner don't need top-tier; spend Opus 4.8 on builders, the reporter, and Q&A. And give each phase a token budget and a hard stop condition — a one-day event is the wrong place to discover a runaway loop.

## The meeting UX

The meeting looks like a Zoom call. A slide stage dominates the screen. A thin rail of agent tiles sits beside it — generated PNG portraits, role names rather than cute names ("Claude — Tests," "Claude — Migration," "Claude — Q&A"), a speaking ring on the presenter, mute icons on the idle, and a human tile labeled "You — PI" with a live mic level. A red REC indicator is real: it means minutes are being taken. A live-minutes strip along the bottom shows the conversation being captured.

The reporter emits slides as structured JSON, never free-form HTML; the meeting app owns the rendering. Each slide carries terse visual content, a conversational narration field that becomes the TTS script, and a type that governs the turn-taking protocol:

Info slides are presented aloud, pause briefly for questions, and auto-advance on silence. Question slides are where the agents need input — unresolved items and escalated contract questions land here; the meeting hard-gates until answered. Decision slides close every meeting with proposed next steps and require an explicit Approve or Redirect.

Interruption uses push-to-talk — hold space to speak, which maps to raising your hand and is robust in a noisy venue. The human may raise a hand mid-page; the agent finishes its sentence, then yields. Once the human has engaged on a page, the conversation pins to that page and the floor stays with the human until they explicitly release it ("okay, continue"). Follow-up questions are answered by a dedicated Q&A agent (server-side Opus 4.8) grounded in the briefing's `artifacts` payload — real diffs, git log, test output, reviewer verdicts — so answers are grounded in artifacts rather than summary vibes, including the honest "no, that case wasn't tested; want me to?" When the human redirects on a decision slide, the slide updates live with the change before approval. That visible edit is the product's thesis in one frame.

If the human schedules the meeting for later, the wait isn't dead time: the reporter preps appendix slides for anticipated questions. "While you were away, I prepped a deeper dive on the flaky tests" is the PhD-student touch that sells the metaphor.

*Note: "Any project where a dashboard is the main feature" is a prohibited category. Lab Meeting is safe — it is an interactive control surface with voice and decision gates, not passive observability — but never frame or demo it as a dashboard. The decision gate and the live-editing redirect slide are what make it not a dashboard.*

## Memory

Two tiers, deliberately simple. Meeting minutes — a directory of markdown files recording decisions, action items, deferred questions, and the human's stated preferences — capture direction; the latest minutes are injected into every subsequent sprint. The `docs/` directory, maintained by the in-lane docs agents, captures confirmed current state of the codebase. Direction plus state is enough context for any new agent to orient. This directly counters goal drift — the documented failure mode where agents lose fidelity to the objective over long horizons — by re-anchoring every sprint to what the human actually said and what the code actually is. Continuity should be audible: "as decided last meeting, rate limiting was deferred to sprint five."

## The demo

The build is self-hosting: the dynamic workflows that build this product report their progress through the product. Kick off the real workflow in the morning and let it accumulate two or three genuine meeting cycles, with real minutes, during the day. The live demo is then the next meeting in the series — agents present actual work from the actual repo, the judges watch a live Q&A exchange, the human pushes back on a proposed plan, the decision slide updates, the next sprint launches. One full control loop, live, with bounded risk. A recorded run is the parachute if the venue audio fails.

Show the paper trail: the minutes directory, the spec archive with review verdicts, and the docs directory are a literal build log of the day, generated as a side effect of supervision. That's the knowledge-base claim proven by artifact.

The pitch in three sentences: Opus 4.8 made agents capable of working alone for hours, and Anthropic's docs say human sign-off between stages means chaining workflow runs — but nobody built the sign-off layer. This is that layer, shaped like the oldest human-in-the-loop protocol there is: the lab meeting. It was built by agents who reported to me through it.

### Scoring alignment (why this wins points, by category)

- **Impact 35%:** framed as a *layer over any workflow* (the curl-in claim), not a single app. Counters the real "humans lose the thread" problem. Multi-project/multi-user capable.
- **Demo 35%:** the live URL is rock-solid because the front-of-house is deployed early and the text/slides/Q&A path never depends on venue audio. The on-stage loop-close is the wow.
- **Opus 4.8 use 15%:** agents presenting and *defending* their own work; grounded Q&A answering from real artifacts incl. honest "not tested"; the reporter synthesizing a coherent briefing from heterogeneous agent outputs.
- **Orchestration 15%:** the event asks "is 'done' verifiable by the model without a human — a test suite, a responding URL, a rubric file?" The spec → impl-reviewer → test-until-green loop *is* that. Make `rubric.md` and `SPEC_TEMPLATE.md` acceptance criteria explicit and repeatable.

## Delegation plan

**Kickoff (first ~45 minutes, timeboxed).** A planning session with Opus 4.8 in Claude Code — fittingly, the unstructured version of the product itself. First message: this doc plus the companion files; ask for critique before artifacts. Use Plan Mode for the first half and push back conversationally. The session's exit criteria are artifacts, not a feeling of readiness:

- **A hello-world meeting app deployed to its real live URL with auto-deploy on push** — so "live URL" is never at risk again. (New first task, forced by the deploy requirement.)
- The briefing/slide JSON schema and the HTTP contract above.
- The reporter prompt (ending in the `curl POST` to `/api/briefings`).
- `rubric.md` — the orchestration story is graded on it; write it explicitly.
- CLAUDE.md carrying the product vision, the schema location, the HTTP contract, and conventions (this is how the kickoff's understanding propagates to every future subagent).
- The tool allowlist configured so workflow agents don't stall on permission prompts.
- The `/sprint` workflow written by Opus 4.8 from a detailed ultracode prompt, run once on a toy goal, and saved.

Personally read three things before saving — the schema, the reporter prompt, and the workflow script. A flaw in any of these propagates into every sprint; everything downstream of these contracts gets reviewed the product's own way, at meetings. End the kickoff by launching Sprint 1 before finishing personal setup — wall-clock hours of agents working in the background are the scarce resource, not typing speed. Keep this session open all day as the director's chair: resume-after-pause works only within the session that launched the run.

**Solo job split.** What you personally own (don't delegate): deploy skeleton, the contracts, `rubric.md`, CLAUDE.md, reporter prompt, tool allowlist, and the integration glue (ingest wiring + the local poller). Everything else is delegated to sprints — the agents are your team; good orchestration multiplies you.

**Sprint 1 — deployed meeting app MVP.** Ingest endpoint + DB, slide renderer from JSON, page-gated flow with text input, approve/redirect on decision slides. Sprint 1's briefing is read by hand as raw JSON, because the app doesn't exist yet — keep that in the demo story: the first meeting was held in a text file; every meeting after was held in the product the first meeting reported on.

**Sprint 2 — close the loop.** Minutes written from meeting outcomes (`POST /api/minutes`), the next sprint enqueued, and the local poller (`GET /api/next-sprint`) shelling out to headless Claude Code. Sprint 2's readout is the first real meeting; the system is self-hosting from here, and every briefing and minutes file is demo evidence accumulating on disk.

**Sprint 3 — Q&A and voice.** The grounded server-side Q&A agent first (the Opus 4.8 showcase, deploys cleanly), then TTS from the narration field and push-to-talk ASR. Voice is the piece most likely to need hands-on work; if the workflow's attempt is janky, take it over manually and run Sprint 4 in parallel — reallocating effort is the PI's job.

**Sprint 4 — the Zoom skin.** Avatar tiles, speaking rings, REC indicator, live-minutes strip. Generate avatar PNGs by hand in parallel (consistent style, one per role) — static assets, not worth agent time. Sprint 4's readout, held in the polished UI, doubles as demo rehearsal.

**Standing rules.** Keep sprint goals narrow and concrete; vague goals produce sprawling fan-outs and token burn. Watch runs in /workflows — drilling into agents is also the fastest way to learn the feature being demoed. If any sprint flails for more than ~20 minutes, stop it (completed agents' work is kept), finish that piece by hand, and move on: the demo needs the system to be real, not a purity oath that every line was agent-written. Don't exit Claude Code mid-run. Reserve ~45 minutes before 5:00 PM for the 1-minute demo video, the submission form, and a repo-is-public check.

## Build order

1. Kickoff artifacts: **deployed hello-world at a live URL**, schema + HTTP contract, reporter prompt, `rubric.md`, CLAUDE.md, allowlist, saved `/sprint` workflow.
2. Sprint 1: deployed meeting server and renderer, page-gated flow with text input, ingest endpoint + DB.
3. Sprint 2: minutes loop, sprint enqueue, and the local poller — the system becomes self-hosting.
4. Sprint 3: grounded server-side Q&A, then voice (TTS narration, push-to-talk ASR).
5. Sprint 4: Zoom-style polish and avatars.
6. Stretch: real Google Calendar invites; multiple presenting agents per meeting; appendix-slide prep during scheduled waits.

Items one through three are a coherent, deployable demo on their own. Four makes it memorable. Everything after is gravy.

## Submission checklist

- Public GitHub repo (standalone/extractable; only what was built today).
- Live URL reachable and serving a real meeting.
- 1-minute demo video.
- Brief + `rubric.md` + session log (the kickoff/sprint sessions).
