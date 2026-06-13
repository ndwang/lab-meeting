# Minutes Status Machine — Server Routes

## Overview
- Purpose: Replace the old single-step `POST /api/minutes` (which recorded + enqueued immediately)
  with five new/updated routes that implement the resolved→composing→composed→approved status
  machine. The enqueue step moves to `POST /api/minutes/:id/approve`.
- Background: The daemon (poll.mjs) will poll `GET /api/compose/pending` to claim minutes rows
  ready for composition; the host agent will post the composed instruction to
  `POST /api/minutes/:id/instruction`; the browser will poll `GET /api/minutes?briefingId=N` and
  then approve via `POST /api/minutes/:id/approve`. The server holds no LLM; it is purely a
  state-machine bus.
- Deliverables: Updated/new route handlers in `server/src/app.js`, updated imports from `db.js`,
  and fully rewritten `server/test/minutes.test.js` (ALL old tests replaced with tests matching the
  new contracts; no test that assumed direct-enqueue survives unchanged).

## Requirements
- Goal / deliverables: All route changes in `server/src/app.js`; all route tests in
  `server/test/minutes.test.js`.
- MVP:
  1. `POST /api/minutes` — browser-facing, no token. Body `{ briefingId, outcome, directive, answers? }`.
     Insert a minutes row with status='resolved'. Return `{ minutesId }` with HTTP 201.
     400 on missing briefingId/outcome/directive or invalid outcome. Does NOT enqueue.
  2. `GET /api/compose/pending` — requires bearer token. Atomically claim the oldest 'resolved'
     minutes row (status→'composing') and return
     `{ minutesId, briefingId, outcome, directive, answers }`. 204 if none.
  3. `POST /api/minutes/:id/instruction` — requires bearer token. Body `{ goal, minutesText }`.
     Set composed_goal=goal, composed_minutes=minutesText, status='composed'. Return `{ ok:true }`.
     404 if unknown id (setComposed returns false). 400 if goal or minutesText are missing.
  4. `GET /api/minutes?briefingId=N` — browser-facing, no token. Return the minutes row(s) for
     that briefing as `[{ id, status, outcome, directive, composedGoal, composedMinutes, created_at }]`.
     400 if briefingId is absent or not a valid integer.
  5. `POST /api/minutes/:id/approve` — browser-facing, no token. Body `{ goal? }`. Enqueue
     sprint_queue(goal = provided goal else composed_goal, minutes = composed_minutes) and set
     status='approved'. Return `{ queuedSprintId }` with HTTP 201. 409 if the db throws an error
     containing "not composed". 404 if the db throws an error containing "not found".
- Non-goals: Any changes to `server/src/db.js`; voice/TTS; the Q&A routes; briefing routes;
  `GET /api/next-sprint`; `scripts/poll.mjs`.
- Acceptance criteria:
  1. `POST /api/minutes` returns 201 `{ minutesId }` with a valid integer; does NOT call
     `enqueueSprint`.
  2. `POST /api/minutes` 400 on missing briefingId, missing outcome, missing directive, or invalid
     outcome (not 'approve'|'redirect').
  3. `GET /api/compose/pending` without token → 401. With token and no pending rows → 204.
     With token and a pending 'resolved' row → 200 `{ minutesId, briefingId, outcome, directive, answers }`.
  4. `POST /api/minutes/:id/instruction` without token → 401. With token and valid id → 200
     `{ ok:true }`. With token and unknown id (setComposed returns false) → 404.
     Missing goal or minutesText → 400.
  5. `GET /api/minutes?briefingId=N` → 200 `[{ id, status, outcome, directive, composedGoal,
     composedMinutes, created_at }]`. Missing or non-integer briefingId → 400.
  6. `POST /api/minutes/:id/approve` on a 'composed' row → 201 `{ queuedSprintId }` (integer).
     On a non-'composed' row (approveMinutes throws "not composed") → 409.
     On an unknown id (approveMinutes throws "not found") → 404.
  7. All existing route tests in `minutes.test.js` that cover `GET /api/next-sprint` continue to
     pass (the three GET /api/next-sprint tests: 401, 204, 200 with sprint data). These tests are
     kept as-is. All other tests in `minutes.test.js` (the direct-enqueue POST /api/minutes tests)
     are fully replaced — they no longer match the new contract and must be rewritten from scratch.
  8. The `renderMinutes` helper is removed from `app.js` (the host agent now composes this text;
     the server no longer generates it). `enqueueSprint` is no longer imported.
- Constraints / risks:
  - This spec owns `server/src/app.js` and `server/test/minutes.test.js` exclusively. The
    `server/src/db.js` changes come from the `minutes-status-machine-db` spec — the builder must
    treat the new db functions as the stable interface to program against.
  - `requireToken` is already implemented in `app.js` — reuse it.
  - The db injection pattern (`buildApp({ db })`) must be preserved so tests can inject a fake db.
  - The fake db in `minutes.test.js` must include stubs for all new functions
    (`claimPendingCompose`, `setComposed`, `getMinutesForBriefing`, `approveMinutes`) in addition
    to keeping `insertBriefing`, `listBriefings`, `getBriefing`, `claimNextSprint`,
    `insertQuestion`, `claimPendingQuestion`, `answerQuestion`, `listQAForBriefing`.
  - The `enqueueSprint` stub must be removed from fakeDb (or at minimum not registered in the real
    db export) to ensure the test verifies the route does not call it.
  - Route registration order for minutes routes: `GET /api/minutes` (query-param route) must be
    registered BEFORE any `GET /api/minutes/:id` route to avoid Fastify treating the query-param
    form as a param route match. The POST param routes (`POST /api/minutes/:id/instruction` and
    `POST /api/minutes/:id/approve`) are POST method and therefore cannot conflict with the GET
    query-param route regardless of order; the ordering requirement is specifically about GET
    routes.
  - Error discrimination for `POST /api/minutes/:id/approve`: the db's `approveMinutes` throws
    distinct errors — message contains "not found" for unknown id, message contains "not composed"
    for wrong-status rows. The route catches and inspects `err.message` to map to 404 vs 409.
    This is the agreed contract between the db spec and routes spec.

## Design

### Target Files
- Update:
  - `server/src/app.js` - replace POST /api/minutes handler; add four new routes; remove
    `renderMinutes`; update imports from db.js (remove `enqueueSprint`; add
    `claimPendingCompose`, `setComposed`, `getMinutesForBriefing`, `approveMinutes`)
  - `server/test/minutes.test.js` - replace ALL tests that assumed direct-enqueue (6 tests);
    add tests for five new route contracts; keep the 3 GET /api/next-sprint tests unchanged

### Modules, Classes, And Functions
- Module: `server/src/app.js`
  - Import additions: `claimPendingCompose`, `setComposed`, `getMinutesForBriefing`, `approveMinutes`
    from `./db.js`
  - Remove: `renderMinutes` helper function; `enqueueSprint` import
  - Updated route: `POST /api/minutes` — validates body, calls `db.insertMinutes`, returns
    `{ minutesId }`. No call to `enqueueSprint`.
  - New route: `GET /api/compose/pending` — `requireToken`; calls `db.claimPendingCompose()`;
    204 if null.
  - New route: `POST /api/minutes/:id/instruction` — `requireToken`; validates `{ goal, minutesText }`;
    calls `db.setComposed({ id, composedGoal: goal, composedMinutes: minutesText })`; 404 if false.
  - New route: `GET /api/minutes` — no token; registered before any `GET /api/minutes/:id` route;
    parse `req.query.briefingId` as integer; calls `db.getMinutesForBriefing(briefingId)`; returns array.
  - New route: `POST /api/minutes/:id/approve` — no token; calls
    `db.approveMinutes({ id, goal: body.goal })` inside a try/catch; inspects `err.message`:
    contains "not composed" → 409; contains "not found" → 404; 201 `{ queuedSprintId }` on success.

### Data Models
No new data models — all schema changes belong to the db spec. Routes read/write through db functions.

### Errors And Exceptions
- Error: missing/invalid body fields on POST /api/minutes → 400 `{ error: string }`
- Error: requireToken fails → 401 `{ error: 'unauthorized' }`
- Error: unknown id on POST /api/minutes/:id/instruction (setComposed returns false) → 404 `{ error: 'not found' }`
- Error: missing goal or minutesText on POST /api/minutes/:id/instruction → 400
- Error: approveMinutes throws message containing "not composed" → 409 `{ error: 'minutes not yet composed' }`
- Error: approveMinutes throws message containing "not found" → 404 `{ error: 'not found' }`
- Error: missing/invalid briefingId on GET /api/minutes → 400 `{ error: 'briefingId is required' }`

## Test Cases
- Normal:
  - POST /api/minutes with valid body → 201 `{ minutesId: 11 }`; db.insertMinutes called once with
    `{ briefingId, outcome, directive, answers: [...] }`; db does NOT have enqueueSprint in fakeDb
  - GET /api/compose/pending with token, pending row → 200 with expected shape
  - POST /api/minutes/:id/instruction with token → 200 `{ ok: true }`; setComposed called with
    `{ id, composedGoal: goal, composedMinutes: minutesText }`
  - GET /api/minutes?briefingId=5 → 200, returns array from db.getMinutesForBriefing(5)
  - POST /api/minutes/:id/approve on composed row → 201 `{ queuedSprintId: 22 }`
  - GET /api/next-sprint 204 when queue empty (kept from existing tests, unchanged)
  - GET /api/next-sprint 200 with sprint data (kept from existing tests, unchanged)
- Error:
  - POST /api/minutes missing briefingId → 400
  - POST /api/minutes invalid outcome → 400
  - GET /api/compose/pending no token → 401
  - GET /api/compose/pending no pending rows → 204
  - POST /api/minutes/:id/instruction no token → 401
  - POST /api/minutes/:id/instruction unknown id (setComposed returns false) → 404
  - POST /api/minutes/:id/instruction missing minutesText → 400
  - GET /api/minutes missing briefingId query param → 400
  - GET /api/minutes non-integer briefingId → 400
  - POST /api/minutes/:id/approve db throws error with "not composed" in message → 409
  - POST /api/minutes/:id/approve db throws error with "not found" in message → 404
  - GET /api/next-sprint 401 without token (kept from existing tests, unchanged)
- Boundary:
  - POST /api/minutes answers field omitted → insertMinutes called with `answers: []` (direct
    field, not a payload wrapper — the test assertion is rewritten to check
    `db.calls.insertMinutes[0].answers` not `db.calls.insertMinutes[0].payload.answers`)
  - POST /api/minutes/:id/approve body omits goal → approveMinutes called with `{ id, goal: undefined }`;
    the db layer uses composed_goal in that case

## Verification
- Commands: `cd server && node --test test/minutes.test.js`
- Manual checks: Sequence through the full status machine with curl against a running server +
  real DB; confirm status column transitions in psql.

## Completion Criteria
- All acceptance criteria met, test cases passing, implementation review passed,
  docs/ updated in this worktree to reflect the change.
