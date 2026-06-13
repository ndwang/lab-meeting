# Minutes Status Machine — DB Layer

## Overview
- Purpose: Extend the `minutes` table with status/composed columns and add the five db helper
  functions that drive the new resolved→composing→composed→approved status machine.
- Background: Today `insertMinutes` writes a bare row; `POST /api/minutes` immediately also calls
  `enqueueSprint`. The new flow decouples recording the human's decision from enqueuing: a host
  agent composes the next instruction, the human approves it, and only then is a sprint queued.
  The minutes row is the durable state that tracks where the handoff is.
- Deliverables: Updated SCHEMA in `server/src/db.js` (idempotent for fresh and existing DBs),
  updated `insertMinutes`, and four new db helper functions. No app.js changes here.

## Requirements
- Goal / deliverables: All db-layer changes in `server/src/db.js`.
- MVP:
  - Schema is idempotent: `CREATE TABLE IF NOT EXISTS` includes all new columns AND
    `ALTER TABLE minutes ADD COLUMN IF NOT EXISTS` statements cover each new column for
    existing DBs.
  - New columns on `minutes`: `directive TEXT`, `answers JSONB`, `composed_goal TEXT`,
    `composed_minutes TEXT`, `status TEXT NOT NULL DEFAULT 'resolved'`.
  - `insertMinutes` now accepts `{ briefingId, outcome, directive, answers }` and writes all
    fields; the old `payload` column is removed from this function's INSERT (the fields are now
    stored in dedicated columns). The existing `payload` column on live DBs is simply left as-is
    (unused and never referenced). New code never reads or writes `payload`.
  - `claimPendingCompose()` — atomically marks the oldest `resolved` row `composing` and returns
    its data; returns null when none.
  - `setComposed({ id, composedGoal, composedMinutes })` — sets the two composed columns and
    status='composed'; returns true if updated, false if id not found.
  - `getMinutesForBriefing(briefingId)` — returns all minutes rows for a briefing as an array,
    oldest-first, with camelCase keys.
  - `approveMinutes({ id, goal })` — enqueues sprint_queue using provided goal (or falls back to
    composed_goal), sets status='approved', returns the new sprint queue id. Throws if the row is
    not found or not in 'composed' status.
- Non-goals: Route changes; client changes; altering the `sprint_queue` or `qa` table.
- Acceptance criteria:
  1. After `initDb()`, a fresh DB has a `minutes` table with columns: `id`, `briefing_id`,
     `outcome`, `directive`, `answers`, `composed_goal`, `composed_minutes`, `status`,
     `created_at`. The `payload` column is NOT present in a fresh DB (do not include it in
     `CREATE TABLE IF NOT EXISTS`).
  2. `initDb()` on an existing DB that already has `id, briefing_id, outcome, payload, created_at`
     columns succeeds (no error) and adds the missing columns; existing rows are unaffected. The
     existing `payload` column is left as-is — it is neither dropped nor referenced. New INSERTs
     must not write to `payload`; the `NOT NULL` constraint on `payload` in existing DBs is
     irrelevant because no new INSERT touches that column.
  3. `insertMinutes({ briefingId:1, outcome:'redirect', directive:'do X', answers:[{title:'Q1',answer:'yes'}] })`
     returns an integer id; the row has `status='resolved'`.
  4. `claimPendingCompose()` on a DB with one `resolved` row returns
     `{ minutesId, briefingId, outcome, directive, answers }` and the row's status becomes
     `'composing'`. A second call returns null (row is no longer `resolved`).
  5. `setComposed({ id, composedGoal:'goal text', composedMinutes:'minutes text' })` sets the
     two columns and status='composed'; returns true. Returns false for unknown id.
  6. `getMinutesForBriefing(briefingId)` returns an array with fields
     `{ id, status, outcome, directive, composedGoal, composedMinutes, created_at }`, ordered by
     id ascending.
  7. `approveMinutes({ id, goal:'override' })` on a `'composed'` row: inserts a sprint_queue row
     with goal='override', sets status='approved', returns the sprint queue id (integer).
  8. `approveMinutes({ id })` with no goal field uses the row's `composed_goal`.
  9. `approveMinutes` on a row not in `'composed'` status (e.g. still 'resolved') throws an error
     with message containing "not composed".
  10. `approveMinutes` on an id that does not exist in the `minutes` table throws an error with
      message containing "not found". This is a distinct error from "not composed" so the routes
      layer can discriminate 404 vs 409.
- Constraints / risks:
  - The `payload` column already exists on the live DB's `minutes` table with a `NOT NULL`
    constraint. The new `insertMinutes` must NOT write to `payload`. Because existing rows already
    satisfy the NOT NULL constraint and new INSERTs omit that column entirely, this is safe — Postgres
    will not enforce NOT NULL on columns not included in the INSERT column list when the column
    already has data for existing rows. Fresh DBs created from the new `CREATE TABLE IF NOT EXISTS`
    will not have a `payload` column at all.
  - `claimPendingCompose` must use `FOR UPDATE SKIP LOCKED` (same pattern as `claimNextSprint`)
    for safe concurrent claim.
  - `approveMinutes` must execute the INSERT into `sprint_queue` and the UPDATE of `minutes.status`
    in a single transaction so they are atomic.
  - The two distinct throws from `approveMinutes` must be unambiguous: unknown id → message
    contains "not found"; wrong status → message contains "not composed". The routes layer
    catches on these substrings.

## Design

### Target Files
- Update:
  - `server/src/db.js` - schema migration, updated `insertMinutes`, four new helper functions

### Modules, Classes, And Functions
- Module: `server/src/db.js`
  - Function: `insertMinutes({ briefingId, outcome, directive, answers })`
    - Responsibility: INSERT a minutes row with status='resolved'; return new id.
    - Input: `{ briefingId:number, outcome:string, directive:string, answers:array }`
    - Output: `number` (new row id)
    - Dependencies: `pool`
  - Function: `claimPendingCompose()`
    - Responsibility: Atomically mark oldest 'resolved' row 'composing'; return its data or null.
    - Input: none
    - Output: `{ minutesId, briefingId, outcome, directive, answers }` or `null`
    - Dependencies: `pool` (uses FOR UPDATE SKIP LOCKED)
  - Function: `setComposed({ id, composedGoal, composedMinutes })`
    - Responsibility: Set composed_goal, composed_minutes, status='composed' on a row.
    - Input: `{ id:number, composedGoal:string, composedMinutes:string }`
    - Output: `boolean` (true if updated, false if not found)
    - Dependencies: `pool`
  - Function: `getMinutesForBriefing(briefingId)`
    - Responsibility: Return all minutes rows for a briefing, oldest-first, with camelCase keys.
    - Input: `briefingId: number`
    - Output: `Array<{ id, status, outcome, directive, composedGoal, composedMinutes, created_at }>`
    - Dependencies: `pool`
  - Function: `approveMinutes({ id, goal? })`
    - Responsibility: In a transaction: fetch the row, throw "not found" if missing, throw "not
      composed" if status !== 'composed', then enqueue sprint_queue, set status='approved'. Returns
      the new sprint_queue id.
    - Input: `{ id:number, goal?:string }` — `goal` overrides `composed_goal` if provided.
    - Output: `number` (sprint_queue id)
    - Dependencies: `pool`

### Data Models
- Model: `minutes` table (updated)
  - New columns added:
    - `directive TEXT` — the human's raw direction text
    - `answers JSONB` — captured Q&A answers array
    - `composed_goal TEXT` — the host agent's composed next sprint goal
    - `composed_minutes TEXT` — the host agent's composed minutes narrative
    - `status TEXT NOT NULL DEFAULT 'resolved'` — state machine: resolved|composing|composed|approved
  - Existing columns kept: `id`, `briefing_id`, `outcome`, `created_at`, `payload` (existing DBs only; never referenced in new code)

### Errors And Exceptions
- Error: `approveMinutes` called with an id that does not match any row → throw `Error('minutes row id=N not found')`
- Error: `approveMinutes` called on a row not in 'composed' status → throw `Error('minutes row id=N is not composed')`
- Error: pool query failure → propagate (fail fast)

## Test Cases
- Normal:
  - `insertMinutes` inserts and returns integer id; inserted row has status='resolved'
  - `claimPendingCompose` returns correct fields (`{ minutesId, briefingId, outcome, directive, answers }`); subsequent call returns null
  - `setComposed` returns true; row has expected composed fields and status='composed'
  - `setComposed` returns false for unknown id
  - `getMinutesForBriefing` returns array in id-ascending order with camelCase keys
  - `approveMinutes` with explicit goal enqueues with that goal; sets status='approved'
  - `approveMinutes` with no goal uses composed_goal
- Error:
  - `approveMinutes` on 'resolved' row throws with message containing "not composed"
  - `approveMinutes` on unknown id throws with message containing "not found"
  - `claimPendingCompose` when no resolved rows returns null
- Boundary:
  - `answers` is an empty array → `insertMinutes` succeeds; `getMinutesForBriefing` returns a one-element array with `answers=[]` on that row
  - `initDb()` runs twice without error (idempotency)

## Verification
- Commands: `cd server && node --test test/minutes.db.test.js` (integration test against a real
  Postgres; requires DATABASE_URL to be set; the test creates/tears down its own rows)
- Manual checks: Run `initDb()` against the live Render DB via a migration script and confirm
  no error and the new columns appear in `\d minutes`.

## Completion Criteria
- All acceptance criteria met, test cases passing, implementation review passed,
  docs/ updated in this worktree to reflect the change.
