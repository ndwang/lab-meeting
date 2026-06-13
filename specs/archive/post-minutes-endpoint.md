# POST /api/minutes — Server Endpoint

<!-- Sprint 2 spec. Planner-authored. Revised after spec review round 1. -->

## Overview
- Purpose: Add the `POST /api/minutes` route that the browser calls when the human resolves a
  meeting's decision slide. Persists the outcome and queues the next sprint.
- Background: The decision slide is terminal. When the PI clicks Approve or Redirect, the client
  must record the meeting outcome and enqueue a next-sprint row so the local poller can drain it.
  Auth is intentionally absent on this endpoint (browser-facing, no token in the SPA).
- Deliverables: Route handler, two new db helper functions (`insertMinutes`, `insertSprintQueue`),
  and a test file covering the happy path, validation errors, and unknown briefingId.

## Requirements
- Goal / deliverables: Route `POST /api/minutes` in `server/src/app.js`; helper functions in
  `server/src/db.js`; test in `server/test/minutes.test.js`.
- MVP:
  - Accept `{ briefingId, outcome, directive, answers? }`.
  - Persist a `minutes` row with outcome + payload (full body).
  - Persist a `sprint_queue` row with goal=directive and a human-readable `minutes` text that
    includes outcome, directive, and any answers.
  - Return `{ minutesId, queuedSprintId }` with HTTP 201.
- Non-goals: bearer token auth on this route; voice/TTS; any queue drain logic.
- Acceptance criteria:
  1. `POST /api/minutes` with valid body returns HTTP 201 and `{ minutesId, queuedSprintId }` where
     both are integers.
  2. Missing `briefingId` (absent from body OR explicitly `null`) OR missing `outcome` OR missing
     `directive` → HTTP 400 with `{ error: string }`. Validation uses a truthiness check: any falsy
     value for these three fields (including `null`, `undefined`, `0`, `''`) triggers a 400. The
     builder must apply `if (!body.briefingId || !body.outcome || !body.directive)` (or equivalent).
  3. Invalid `outcome` (not `'approve'` or `'redirect'`) → HTTP 400.
  4. The persisted `minutes` row has `briefing_id = briefingId`, `outcome = outcome`,
     and `payload` = the full request body.
  5. The persisted `sprint_queue` row has `goal = directive`, `status = 'pending'`,
     and `minutes` containing the outcome, directive, and each answer title+answer.
  6. No bearer token is required; any request without `Authorization` is accepted.
- Constraints / risks:
  - `briefingId` is a foreign key to `briefings`. If the FK does not exist in the DB the INSERT
    will error — the test uses a mock db, so FK enforcement is mocked.
  - **Mocking strategy:** The test file imports `insertMinutes` and `insertSprintQueue` by name from
    `server/src/db.js`, then stubs them at the module level using Node's `--experimental-mock-module`
    or `import.meta.mock` (Node 22+). Alternatively, the builder should use the same approach as
    `version.test.js` — which calls `buildApp()` without any db mock — but since the new route calls
    db functions, the builder must stub the db functions before calling `buildApp()`. The recommended
    approach is to use `vi` if Vitest is available, or to inject the db functions via a module-level
    variable that the test overrides, OR to restructure so `buildApp()` accepts optional db overrides.
    The simplest workable pattern: export the db helpers from `db.js` and in the test use
    `import { insertMinutes, insertSprintQueue } from '../src/db.js'` + `import.meta.mock` or a
    compatible stub. The builder may choose any pattern that (a) calls `buildApp()` directly and
    (b) prevents any real `pool.query` from firing in tests. Document the chosen pattern in the
    test file's header comment.

## Design

### Target Files
- Update:
  - `server/src/app.js` - add `POST /api/minutes` route; import new db helpers
  - `server/src/db.js` - add `insertMinutes(...)` and `insertSprintQueue(...)` functions
- Add:
  - `server/test/minutes.test.js` - app.inject() tests for the new route

### Modules, Classes, And Functions
- Module: `server/src/db.js`
  - Function: `insertMinutes({ briefingId, outcome, payload })`
    - Responsibility: INSERT a row into `minutes`, return the new `id`.
    - Input: `{ briefingId: number, outcome: string, payload: object }` — `briefingId` will always
      be a truthy integer by the time it reaches this function (validation in the route handler
      guards against falsy values, so this function does not re-validate).
    - Output: `number` (the new row id)
    - Dependencies: `pool` (shared pg Pool)
  - Function: `insertSprintQueue({ goal, minutes })`
    - Responsibility: INSERT a row into `sprint_queue` with `status='pending'`, return the new `id`.
    - Input: `{ goal: string, minutes: string }`
    - Output: `number` (the new row id)
    - Dependencies: `pool` (shared pg Pool)

- Module: `server/src/app.js`
  - Route: `POST /api/minutes`
    - Responsibility: Validate body, call db helpers, return ids.
    - Validation: Check `!body.briefingId || !body.outcome || !body.directive` — falsy test covers
      null, undefined, empty string, and 0. This is an explicit product decision: a null briefingId
      is treated as missing and returns 400, not forwarded to the DB.
    - Input: JSON body `{ briefingId, outcome, directive, answers? }`
    - Output: `{ minutesId, queuedSprintId }` or `{ error }` on failure
    - Dependencies: `insertMinutes`, `insertSprintQueue` from `db.js`

### Data Models
- Model: `minutes` row
  - Fields:
    - `briefing_id: integer` - FK to briefings
    - `outcome: text` - 'approve' or 'redirect'
    - `payload: jsonb` - full request body as received
- Model: `sprint_queue` row
  - Fields:
    - `goal: text` - equals `directive` from the request body
    - `minutes: text` - human-readable summary: outcome + directive + answers
    - `status: text` - always 'pending' at insert time
  - Validation: `goal` NOT NULL (enforced by the schema DDL already present)

### Errors And Exceptions
- Error: falsy `briefingId`, `outcome`, or `directive` → reply 400
  `{ error: 'briefingId, outcome, and directive are required' }`. This includes explicit `null`.
- Error: `outcome` not in `['approve','redirect']` → reply 400
  `{ error: 'outcome must be approve or redirect' }`
- Error: db INSERT failure → let Fastify's default 500 handler propagate (fail fast)

## Test Cases
- Normal:
  - POST with `{ briefingId: 1, outcome: 'approve', directive: 'build X' }` → 201, both ids present
  - POST with `answers: [{ title: 'Q1', answer: 'A1' }]` included → minutes text contains 'Q1: A1'
  - POST with `outcome: 'redirect'` → 201
- Error:
  - Missing `briefingId` (field absent) → 400
  - `briefingId: null` (explicit null) → 400
  - Missing `outcome` → 400
  - Missing `directive` → 400
  - `outcome: 'maybe'` → 400
- Boundary:
  - `answers` field omitted → still 201 (answers are optional)
  - `answers: []` → still 201

## Integrator Note
This spec shares target files (`server/src/app.js`, `server/src/db.js`) with the
`get-next-sprint-endpoint` spec. These two work items run in parallel worktrees. The integrator
must apply the changes from both worktrees sequentially:
1. Merge (or apply) the `post-minutes-endpoint` worktree changes first.
2. Merge (or apply) the `get-next-sprint-endpoint` worktree changes on top — the changes are
   additive (different function names in `db.js`, different route in `app.js`) so textual merge
   should be clean, but the integrator must verify that neither set of additions is lost.

## Verification
- Commands: `cd server && node --test test/minutes.test.js`
- Manual checks: POST `{ briefingId: 1, outcome: 'approve', directive: 'next goal' }` with curl
  against a running server; verify DB rows with `psql`.

## Completion Criteria
- All acceptance criteria met, test cases passing, implementation review passed,
  docs/ updated in this worktree to reflect the change.
