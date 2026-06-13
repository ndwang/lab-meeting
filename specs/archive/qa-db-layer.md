# QA DB Layer

## Overview
- Purpose: Extend `server/src/db.js` with the `qa` table DDL and four storage functions that back the live Q&A channel.
- Background: The attendant daemon claims questions from the server, answers them grounded in the briefing artifacts, and posts answers back. The browser polls for answers. All persistence lives in Postgres via the existing pool.
- Deliverables: `qa` table in SCHEMA; `insertQuestion`, `claimPendingQuestion`, `answerQuestion`, `listQAForBriefing` functions exported from `db.js`.

## Requirements
- Goal / deliverables: Four new exported async functions + `qa` table DDL added to the SCHEMA constant.
- MVP: All four functions work correctly against the real Postgres pool; `initDb()` creates the table on first call.
- Non-goals: No HTTP routes (those are in the server-routes spec). No migration scripts — IF NOT EXISTS DDL is sufficient.
- Acceptance criteria:
  - `qa` table is defined in SCHEMA with columns: `id SERIAL PRIMARY KEY`, `briefing_id INTEGER REFERENCES briefings(id)`, `question TEXT NOT NULL`, `answer TEXT`, `status TEXT NOT NULL DEFAULT 'pending'`, `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`.
  - `insertQuestion({ briefingId, question })` inserts a row with `status = 'pending'` and returns the new row's `id`.
  - `claimPendingQuestion()` atomically claims the oldest `'pending'` row — sets `status = 'claimed'` using `FOR UPDATE SKIP LOCKED` — and returns `{ id, briefingId: briefing_id, question }`; returns `null` when no pending rows exist.
  - `answerQuestion({ id, answer })` sets `answer` and `status = 'answered'` for the given id; returns `true` if a row was updated, `false` if no row matched.
  - `listQAForBriefing(briefingId)` returns all rows for the briefing ordered by `id ASC` as `[{ id, question, answer, status, created_at }]`.
  - All functions fail fast (throw) if the pool is unavailable — no silent fallbacks.
- Constraints / risks: Must not break existing SCHEMA string or any existing exported functions. Add the `qa` DDL block at the end of the SCHEMA constant.

## Design

### Target Files
- Update:
  - `server/src/db.js` - add `qa` table to SCHEMA and export four new async functions

### Modules, Classes, And Functions
- Module: `server/src/db.js` - storage layer
  - Function: `insertQuestion({ briefingId, question })` - insert a pending Q&A row
    - Input: `{ briefingId: number, question: string }`
    - Output: `number` (new row id)
    - Dependencies: `pool`
  - Function: `claimPendingQuestion()` - atomically claim oldest pending question
    - Input: none
    - Output: `{ id, briefingId, question }` or `null`
    - Dependencies: `pool`
  - Function: `answerQuestion({ id, answer })` - record answer and mark answered
    - Input: `{ id: number, answer: string }`
    - Output: `boolean` (true = updated, false = not found)
    - Dependencies: `pool`
  - Function: `listQAForBriefing(briefingId)` - fetch full Q&A thread oldest-first
    - Input: `briefingId: number`
    - Output: `Array<{ id, question, answer, status, created_at }>`
    - Dependencies: `pool`

### Data Models
- Model: `qa` table - stores one question+answer pair per row
  - Fields:
    - `id: SERIAL PRIMARY KEY` - surrogate key
    - `briefing_id: INTEGER REFERENCES briefings(id)` - owning briefing
    - `question: TEXT NOT NULL` - the human's question text
    - `answer: TEXT` - nullable until answered
    - `status: TEXT NOT NULL DEFAULT 'pending'` - lifecycle state: 'pending' | 'claimed' | 'answered'
    - `created_at: TIMESTAMPTZ NOT NULL DEFAULT now()` - server-stamped, not client

### Errors And Exceptions
- Error: pool not initialised (initDb not called) - throws immediately, no silent fallback
- Error: `answerQuestion` called with unknown id - returns `false`, does not throw

## Test Cases
- Normal:
  - `insertQuestion` returns a numeric id and the row is retrievable via `listQAForBriefing`.
  - `claimPendingQuestion` on one pending row returns the row with `briefingId` (not `briefing_id`) and marks it `'claimed'`.
  - `claimPendingQuestion` called when no pending rows exist returns `null`.
  - `answerQuestion` for a known id sets status to `'answered'` and returns `true`.
  - `listQAForBriefing` returns rows in ascending id order.
- Error:
  - `answerQuestion` with an unknown id returns `false`.
- Boundary:
  - `listQAForBriefing` with no rows for a briefing returns `[]`.
  - `claimPendingQuestion` with only `'claimed'` or `'answered'` rows returns `null`.

## Verification
- Commands: `cd server && node --test test/qa.test.js` (the route-layer tests exercise all db functions via a fake db that mirrors the real function signatures; the SQL logic is confirmed by reading the implementation). Run `cd server && node --test` to confirm all server tests remain green.
- Manual checks: `initDb()` followed by direct SQL confirms the table DDL and the FOR UPDATE SKIP LOCKED claim pattern.

## Completion Criteria
- All acceptance criteria met, test cases passing, implementation review passed, docs/ updated in this worktree to reflect the change.
