# GET /api/version Endpoint

<!-- One spec per work item. Completed specs move to specs/archive/ — do not delete. -->

## Overview
- Purpose: Expose the repo's `version` field from the root `package.json` over HTTP so consumers (agents, the reporter, human operators) can confirm which build is running without a database or any auth.
- Background: The app already has `GET /api/health`. A version endpoint is the natural companion — it costs nothing, removes guesswork about deployed build, and is verifiable with a single `curl`.
- Deliverables: A route registered in `buildApp()`, an `app.inject()` test, an `npm test` script in `server/package.json`, and updated `docs/README.md`.

## Requirements
- Goal / deliverables:
  - `GET /api/version` returns `{ "version": "<semver string>" }` read from the root `package.json` at module-load time.
  - A test file `server/test/version.test.js` covers the happy path via `app.inject()`.
  - `server/package.json` gains a `"test"` script that runs the test file with Node's built-in test runner (`node --test`).
  - `docs/README.md` is updated to document the new endpoint alongside the existing routes.
- MVP: The route, the test, the script, and the doc update all land in the same work item.
- Non-goals: Auth on this endpoint, caching headers, semver validation, any client-side changes.
- Acceptance criteria:
  1. `GET /api/version` responds with HTTP 200.
  2. The response body is valid JSON with exactly one key `"version"` whose value equals the `"version"` field in `/package.json` (currently `"0.1.0"`).
  3. The route is registered inside `buildApp()` in `server/src/app.js`.
  4. The version string is read from the root `package.json` file at module load time using `fs.readFileSync` or ESM import; it is **not** hard-coded.
  5. Running `npm test` from the `server/` directory exits 0 and prints at least one passing test assertion.
  6. `docs/README.md` lists `GET /api/version` in its current-state section.
- Constraints / risks:
  - The root `package.json` path must be resolved relative to `server/src/app.js` (i.e., `../../package.json`) so it works whether the server is started from any CWD.
  - No database connection is required for this route or its tests — consistent with `buildApp()`'s no-DB design.
  - `server/package.json` must not gain `"type": "module"` through this change; the test file must be ESM-compatible as written (`.js` with `"type": "module"` already set in `server/package.json`).

## Design

### Target Files
- Add:
  - `server/test/version.test.js` - `app.inject()` test for `GET /api/version`
- Update:
  - `server/src/app.js` - register the `GET /api/version` route inside `buildApp()`
  - `server/package.json` - add `"test": "node --test test/version.test.js"` to `"scripts"`
  - `docs/README.md` - document `GET /api/version` in the current-state section

### Modules, Classes, And Functions
- Module: `server/src/app.js` - Fastify app factory
  - Function: `buildApp()` — registers `GET /api/version` returning `{ version }`
  - Responsibility: Read version from `../../package.json` at module load; serve it on `GET /api/version`.
  - Input/output: No inputs for the route. Response: `200 { "version": string }`.
  - Dependencies: `node:fs` (readFileSync) or top-level `import` of the JSON file; no DB.

- Module: `server/test/version.test.js` - test for the version endpoint
  - Responsibility: Call `buildApp()`, inject `GET /api/version`, assert status 200 and body shape.
  - Input/output: None (test runner).
  - Dependencies: `node:test`, `node:assert`, `../src/app.js`.

### Data Models
- No new data models. The route handler reads a static value from `package.json`.
  - `version: string` — the semver string from root `package.json`

### Errors And Exceptions
- Error: `package.json` unreadable at startup — `readFileSync` will throw at module load, crashing the process with a clear ENOENT. No silent fallback.

## Test Cases
- Normal:
  - `GET /api/version` returns status 200 and `{ "version": "0.1.0" }` (or whatever the root package.json version is at test time).
  - Parsed JSON has exactly the key `"version"` present and it is a non-empty string.
- Error:
  - (No runtime errors expected for this read-only, DB-free route; startup crash on missing file is acceptable per fail-fast convention.)
- Boundary:
  - The test must pass when run from a directory other than `server/` (i.e., path resolution must be file-relative, not CWD-relative).

## Verification
- Commands:
  - `cd server && npm test` — must exit 0.
  - `cd server && node -e "import('./src/app.js').then(m => m.buildApp()).then(app => app.inject({ method: 'GET', url: '/api/version' })).then(r => console.log(r.statusCode, r.body))"` — must print `200 {"version":"0.1.0"}`.
- Manual checks:
  - Confirm `docs/README.md` lists `GET /api/version`.
  - Confirm no hard-coded version string appears in `server/src/app.js`.

## Completion Criteria
- All acceptance criteria met, test cases passing, implementation review passed,
  docs/ updated in this worktree to reflect the change.
