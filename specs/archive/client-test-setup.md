# Client Test Setup and Test Suite

<!-- One spec per work item. Written by the planner, reviewed in batch by the spec reviewer,
     implemented by one builder in an isolated worktree. -->

## Overview
- Purpose: Add a Vitest-based test setup to the client package and write the unit/component tests that cover the `SlideStage` renderer and the `useMeetingState` state machine against the real `briefings/sprint-1.json` fixture.
- Background: The client currently has no test runner. The server uses Node's built-in `node:test`; the client must use Vitest (the standard Vite-ecosystem testing tool). Tests must be runnable via `npm test` in the `client/` directory without a browser or a running server. The `SlideStage` renderer tests need a minimal React DOM environment (jsdom). The `useMeetingState` tests use `renderHook`. The existing server test (`cd server && npm test`) must continue to pass; this item does not touch any server file.
- Deliverables: Vitest config in `client/vitest.config.js`, test scripts in `client/package.json`, and test files in `client/src/__tests__/`.

## Requirements
- Goal / deliverables: Working `npm test` in `client/` that runs Vitest; tests covering `SlideStage` and `useMeetingState` against `sprint-1.json`.
- MVP:
  - `vitest`, `@testing-library/react`, `@testing-library/user-event`, and `jsdom` added to `client` devDependencies.
  - `client/vitest.config.js` sets `environment: 'jsdom'`, `globals: true`, and resolves the project root.
  - `client/package.json` adds `"test": "vitest run"` script.
  - `client/src/__tests__/SlideStage.test.jsx` — component tests for the renderer.
  - `client/src/__tests__/useMeetingState.test.js` — hook tests for the state machine.
  - Both test files import and use `briefings/sprint-1.json` as the test fixture.
  - `cd client && npm test` exits 0 with all tests passing.
  - `cd server && npm test` continues to exit 0 (no server files touched).
- Non-goals: End-to-end browser tests; integration tests that hit a live server; coverage thresholds; CI configuration changes.
- Acceptance criteria:
  1. `client/package.json` has a `"test"` script that runs `vitest run`.
  2. Running `cd client && npm test` exits with code 0 and prints a passing test summary.
  3. `SlideStage.test.jsx` tests: info slide renders Continue button; question slide Submit disabled on empty input, enabled on text; decision slide Approve calls `onDecide('approve', '')`; progress indicator matches `/Slide \d+ of \d+/`; `data-testid="slide-title"`, `data-testid="slide-content"`, `data-testid="slide-narration"` are all present.
  4. `useMeetingState.test.js` tests: `continue()` on info advances index; `answer('text')` records and advances; `answer('')` no-ops; `decide('approve', '')` sets decision without advancing; `decide('redirect', 'x')` sets direction; gate rules (continue on question, answer on info) are no-ops.
  5. Both test files use slides from `briefings/sprint-1.json` as the source fixture (imported directly — the path resolves relative to the repo root from the vitest alias or relative import).
  6. `cd server && npm test` still exits 0 (no regression in server tests).
  7. No test file imports from `server/` and no server file is modified.
- Constraints / risks: `briefings/sprint-1.json` lives outside `client/`; the Vitest config must add an alias or the test must use a relative `../../briefings/sprint-1.json` import path. Use the relative import (simpler, no alias needed). Vitest version must be compatible with Vite 6 — use `vitest@^2`.

## Design

### Target Files
- Add:
  - `client/vitest.config.js` - Vitest configuration (jsdom environment, globals)
  - `client/src/__tests__/SlideStage.test.jsx` - component tests for SlideStage
  - `client/src/__tests__/useMeetingState.test.js` - hook tests for useMeetingState
- Update:
  - `client/package.json` - add `"test": "vitest run"` script; add vitest, @testing-library/react, @testing-library/user-event, jsdom to devDependencies

### Modules, Classes, And Functions
- Module: `client/vitest.config.js` - Vitest configuration
  - Exports a Vitest config object with `test.environment = 'jsdom'` and `test.globals = true`.
  - Dependencies: `vitest/config`; re-uses the Vite React plugin from `vite.config.js` (or duplicates the plugin import).

- Module: `client/src/__tests__/SlideStage.test.jsx` - SlideStage renderer tests
  - Uses `@testing-library/react` `render` and `screen`.
  - Imports `sprint1` from `../../../briefings/sprint-1.json`.
  - Constructs minimal props (`slides`, `currentIndex`, `answers={}`, mock callbacks) from fixture slides.
  - Tests: (see Acceptance Criteria AC3 above)

- Module: `client/src/__tests__/useMeetingState.test.js` - useMeetingState hook tests
  - Uses `@testing-library/react` `renderHook` and `act`.
  - Imports `sprint1` from `../../../briefings/sprint-1.json`.
  - Uses `sprint1.slides` as the input slides array.
  - Tests: (see Acceptance Criteria AC4 above)

### Data Models
- No new data models. Tests consume the `Slide` schema from `briefings/sprint-1.json`.

### Errors And Exceptions
- Error: `briefings/sprint-1.json` path import fails at test time — test fails with a clear module-not-found error. Fix: verify relative path `../../../briefings/sprint-1.json` from `client/src/__tests__/`.

## Test Cases

(These ARE the test cases — this spec item produces the tests.)

### SlideStage tests (`SlideStage.test.jsx`)
- Normal: Render an `info` slide (index 0 of sprint-1 fixture) — `data-testid="slide-title"` contains the title string; `data-testid="slide-content"` contains at least one `<li>`; `data-testid="slide-narration"` contains the narration; "Continue" button is present.
- Normal: Render a `question` slide (construct a minimal `{ type: 'question', title, content, narration }` object) — "Submit" button is disabled; after typing text the "Submit" button becomes enabled; clicking it calls `onAnswer` with the text.
- Normal: Render a `decision` slide (last slide of sprint-1 fixture, index 3) — "Approve" and "Redirect" buttons present; "Redirect" disabled; clicking "Approve" calls `onDecide('approve', '')`.
- Normal: Progress indicator text matches `/Slide 1 of 4/` when `currentIndex=0` and `slides.length=4`.

### useMeetingState tests (`useMeetingState.test.js`)
- Normal: `continue()` on slide 0 (info) → `currentIndex` becomes 1.
- Normal: `answer('great work')` on a question slide → answer recorded, index advances.
- Gate: `answer('')` → no-op.
- Gate: `continue()` on question slide → no-op.
- Gate: `answer('x')` on info slide → no-op.
- Decision: `decide('approve', '')` → `decision.outcome === 'approve'`, index unchanged.
- Decision: `decide('redirect', 'focus on X')` → `decision.direction === 'focus on X'`.
- Boundary: all actions on empty slides array → no crash.

## Verification
- Commands:
  - `cd client && npm test` exits 0, all tests pass.
  - `cd server && npm test` exits 0 (no regression).
- Manual checks: `cd client && npx vitest run --reporter=verbose` shows named tests passing.

## Completion Criteria
- All acceptance criteria met, test cases passing, implementation review passed,
  docs/ updated in this worktree to reflect the change.
