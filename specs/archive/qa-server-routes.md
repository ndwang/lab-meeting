# QA Server Routes

## Overview
- Purpose: Add four HTTP endpoints to `server/src/app.js` that implement the Q&A channel: the browser posts questions and polls answers; the daemon claims questions and posts answers back.
- Background: The Q&A channel is a store-and-forward relay. The meeting app holds no LLM — it is only a message bus. The server routes wire the `db.js` functions (from the qa-db-layer spec) into the HTTP contract specified in CLAUDE.md.
- Deliverables: Four new routes in `buildApp()`; four new db stubs added to the `realDb` object and the fake-db helpers in tests; a new test file `server/test/qa.test.js`.

## Requirements
- Goal / deliverables: Four routes registered in `buildApp()`, covered by `app.inject()` tests, existing tests unchanged.
- MVP: All four routes behave per the HTTP contract; auth rules are enforced; validation errors return the correct status codes.
- Non-goals: No LLM integration, no voice, no client UI (that is in client specs). Do not modify `scripts/poll.mjs`.
- Acceptance criteria:
  - `POST /api/qa` — NO bearer token required. Body `{ briefingId, question }`. Calls `db.insertQuestion`. Returns `201 { questionId }`. Returns `400` if `briefingId` is missing or null; returns `400` if `question` is missing or empty string.
  - `GET /api/qa/pending` — REQUIRES bearer token. Calls `db.claimPendingQuestion`. Returns `200 { id, briefingId, question }` when a pending question exists. Returns `204` (empty body) when none.
  - `POST /api/qa/:id/answer` — REQUIRES bearer token. Body `{ answer }`. Calls `db.answerQuestion`. Returns `200 { ok: true }`. Returns `404` if id not found (db returns false). Returns `400` if `answer` is missing or empty string.
  - `GET /api/qa?briefingId=N` — NO bearer token required. Calls `db.listQAForBriefing`. Returns `200` with an array `[{ id, question, answer, status, created_at }]` oldest-first. Returns `400` if `briefingId` query param is absent or not a valid integer — do not silently pass `undefined` to the db layer.
  - `realDb` in `app.js` is extended to include `insertQuestion`, `claimPendingQuestion`, `answerQuestion`, `listQAForBriefing`.
  - All existing endpoints (`/api/briefings`, `/api/minutes`, `/api/next-sprint`, `/api/version`, `/api/health`) remain unmodified and their existing tests pass.
- Constraints / risks: Route for `GET /api/qa/pending` must be registered before any wildcard or parameterized route that could shadow it. The `requireToken` helper is reused as-is — no changes to its logic.

## Design

### Target Files
- Update:
  - `server/src/app.js` - add four routes, extend `realDb` object
- Add:
  - `server/test/qa.test.js` - app.inject() tests for all four routes

### Modules, Classes, And Functions
- Module: `server/src/app.js` - HTTP route layer
  - Route: `POST /api/qa` - browser-facing question ingestion (no auth)
    - Input: `{ briefingId, question }` JSON body
    - Output: `201 { questionId }` or `400 { error }`
    - Dependencies: `db.insertQuestion`
  - Route: `GET /api/qa/pending` - daemon claims oldest pending question (auth required)
    - Input: bearer token in Authorization header
    - Output: `200 { id, briefingId, question }` | `204` | `401`
    - Dependencies: `requireToken`, `db.claimPendingQuestion`
  - Route: `POST /api/qa/:id/answer` - daemon posts answer (auth required)
    - Input: bearer token; `{ answer }` JSON body; `:id` URL param
    - Output: `200 { ok: true }` | `400` | `401` | `404`
    - Dependencies: `requireToken`, `db.answerQuestion`
  - Route: `GET /api/qa` - browser polls Q&A thread (no auth)
    - Input: `?briefingId=N` query param
    - Output: `200 [{ id, question, answer, status, created_at }]`
    - Dependencies: `db.listQAForBriefing`

### Data Models
- No new data models in the route layer — shapes are defined by the db layer.

### Errors And Exceptions
- Error: `POST /api/qa` missing briefingId → `400 { error: 'briefingId and question are required' }`
- Error: `POST /api/qa` missing/empty question → `400 { error: 'briefingId and question are required' }`
- Error: `POST /api/qa/:id/answer` missing/empty answer → `400 { error: 'answer is required' }`
- Error: `POST /api/qa/:id/answer` unknown id → `404 { error: 'not found' }`
- Error: `GET /api/qa/pending` no token → `401 { error: 'unauthorized' }`
- Error: `POST /api/qa/:id/answer` no token → `401 { error: 'unauthorized' }`
- Error: `GET /api/qa` missing `briefingId` query param → `400 { error: 'briefingId is required' }`

## Test Cases
- Normal:
  - `POST /api/qa` with valid body calls `db.insertQuestion` and returns `201 { questionId: <id> }`.
  - `GET /api/qa/pending` with valid token and a pending question returns `200` with `{ id, briefingId, question }`.
  - `GET /api/qa/pending` with valid token and no pending questions returns `204` empty body.
  - `POST /api/qa/:id/answer` with valid token and known id returns `200 { ok: true }`.
  - `GET /api/qa?briefingId=5` returns array from `db.listQAForBriefing(5)`.
  - `GET /api/qa?briefingId=5` does not require a bearer token.
- Error:
  - `POST /api/qa` missing `briefingId` → 400.
  - `POST /api/qa` missing `question` → 400.
  - `GET /api/qa/pending` without bearer token → 401, `db.claimPendingQuestion` not called.
  - `POST /api/qa/:id/answer` without bearer token → 401.
  - `POST /api/qa/:id/answer` with `db.answerQuestion` returning false → 404.
  - `POST /api/qa/:id/answer` missing `answer` → 400.
  - `GET /api/qa` without `briefingId` query param → 400, `db.listQAForBriefing` not called.
- Boundary:
  - `POST /api/qa` does not require a bearer token (browser-facing).
  - `GET /api/qa` does not require a bearer token.
  - `GET /api/qa/pending` route does not shadow parameterized routes.

## Verification
- Commands: `cd server && node --test test/qa.test.js` and `cd server && node --test` (all server tests).
- Manual checks: `curl -X POST /api/qa` without token returns 201; `curl /api/qa/pending` without token returns 401.

## Completion Criteria
- All acceptance criteria met, test cases passing, implementation review passed, docs/ updated in this worktree to reflect the change.
