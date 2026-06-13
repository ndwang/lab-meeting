# GET /api/next-sprint — Server Endpoint

<!-- Sprint 2 spec. Planner-authored. Revised after spec review round 1. -->

## Overview
- Purpose: Add the `GET /api/next-sprint` route that the local poller (`scripts/poll.mjs`) calls
  to atomically claim and drain the oldest pending sprint from the queue.
- Background: After the human approves or redirects, a `sprint_queue` row with `status='pending'`
  is created. The local poller polls this endpoint; when a row is available it should be claimed
  exactly once (atomic `UPDATE … RETURNING`) and returned. The poller re-uses the bearer token.
- Deliverables: Route handler in `app.js`, a `claimNextSprint()` db helper in `db.js`, and tests.

## Requirements
- Goal / deliverables: Route `GET /api/next-sprint` in `server/src/app.js`; helper
  `claimNextSprint()` in `server/src/db.js`; tests in `server/test/next-sprint.test.js`.
- MVP:
  - Require bearer token (`LAB_MEETING_TOKEN`). Return 401 if missing/invalid.
  - Atomically mark the oldest `status='pending'` row as `status='consumed'` via
    `UPDATE … WHERE id=(SELECT id … ORDER BY id ASC LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`.
  - If a row was claimed, return HTTP 200 `{ goal, minutes }`.
  - If no pending row exists, return HTTP 204 (empty body).
- Non-goals: multiple-consumer fan-out; retry logic; any client-side integration.
- Acceptance criteria:
  1. `GET /api/next-sprint` without a valid bearer token → HTTP 401.
  2. When no pending row exists → HTTP 204, empty body.
  3. When a pending row exists → HTTP 200 `{ goal, minutes }` and the row is marked `consumed`.
  4. Two rapid calls with one pending row → first returns 200 with the row; second returns 204
     (the row is already consumed).
  5. Oldest row (lowest id) is returned first.
- Constraints / risks:
  - `FOR UPDATE SKIP LOCKED` requires Postgres 9.5+; already guaranteed by the existing stack.
  - The test uses a mock db to avoid a real Postgres connection; see the mocking strategy note
    below.

## Design

### Target Files
- Update:
  - `server/src/app.js` - add `GET /api/next-sprint` route; import `claimNextSprint`
  - `server/src/db.js` - add `claimNextSprint()` function
- Add:
  - `server/test/next-sprint.test.js` - app.inject() tests for the new route

### Modules, Classes, And Functions
- Module: `server/src/db.js`
  - Function: `claimNextSprint()`
    - Responsibility: Atomically claim the oldest pending sprint_queue row.
    - Input: none
    - Output: `{ goal: string, minutes: string } | null`
    - Dependencies: `pool` (shared pg Pool)
    - Query:
      ```sql
      UPDATE sprint_queue
      SET    status = 'consumed'
      WHERE  id = (
               SELECT id FROM sprint_queue
               WHERE  status = 'pending'
               ORDER  BY id ASC
               LIMIT  1
               FOR UPDATE SKIP LOCKED
             )
      RETURNING goal, minutes
      ```

- Module: `server/src/app.js`
  - Route: `GET /api/next-sprint`
    - Responsibility: Auth guard, call `claimNextSprint`, shape the response.
    - Input: `Authorization: Bearer <token>` header
    - Output: `{ goal, minutes }` on 200, empty body on 204
    - Dependencies: `claimNextSprint` from `db.js`, `requireToken` helper (already present in
      `app.js`)

### Data Models
- Model: `sprint_queue` row (read side)
  - Fields returned: `goal: text`, `minutes: text`
  - The `status` column transitions: `pending` → `consumed` (irreversible, done here)

### Errors And Exceptions
- Error: no valid bearer token → 401 `{ error: 'unauthorized' }` (existing `requireToken` helper)
- Error: db failure → let Fastify's default 500 handler propagate (fail fast)

### Mocking Strategy (for tests)
The test calls `buildApp()` from `server/src/app.js` directly (same pattern as `version.test.js`)
but must prevent real `pool.query` calls. Since `claimNextSprint` is a named export from `db.js`,
the builder should stub it at the module level before `buildApp()` is called. The recommended
pattern:

```js
// At the top of next-sprint.test.js, before importing buildApp:
import * as db from '../src/db.js';
// Then in each test, override the named export:
db.claimNextSprint = async () => ({ goal: 'test goal', minutes: 'test minutes' });
```

If the Node version or ESM semantics do not allow direct property assignment on the namespace
object, the builder should restructure `buildApp()` to accept an optional `{ claimNextSprint }`
override parameter (same pattern as the `post-minutes-endpoint` test). Document the chosen pattern
in the test file header.

## Test Cases
- Normal:
  - With a valid token and one pending row (mock returns `{ goal, minutes }`) → 200, body present
  - After that claim (mock returns null) → 204
- Error:
  - No Authorization header → 401
  - Wrong token → 401
- Boundary:
  - Two pending rows → first call returns the lower-id row; second returns the next (mock two
    sequential non-null returns followed by null)
  - No pending rows at all → 204 immediately (mock returns null)

## Integrator Note
This spec shares target files (`server/src/app.js`, `server/src/db.js`) with the
`post-minutes-endpoint` spec. These two work items run in parallel worktrees. The integrator
must apply the changes from both worktrees sequentially:
1. Merge (or apply) the `post-minutes-endpoint` worktree changes first.
2. Merge (or apply) the `get-next-sprint-endpoint` worktree changes on top. Changes are additive
   — `insertMinutes` + `insertSprintQueue` in `db.js` and the POST route in `app.js` from the
   first spec do not overlap with `claimNextSprint` in `db.js` and the GET route from this spec.
   A textual merge should be clean, but the integrator must confirm that all four function
   additions and both route additions are present in the final files.

## Verification
- Commands: `cd server && node --test test/next-sprint.test.js`
- Manual checks: Insert a `sprint_queue` row via psql; curl with the bearer token; confirm the
  row's status is now `consumed`.

## Completion Criteria
- All acceptance criteria met, test cases passing, implementation review passed,
  docs/ updated in this worktree to reflect the change.
