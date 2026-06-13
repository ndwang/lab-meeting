# Client Router

<!-- One spec per work item. Written by the planner, reviewed in batch by the spec reviewer,
     implemented by one builder in an isolated worktree. -->

## Overview
- Purpose: Add lightweight client-side routing to the SPA so the landing list and the meeting view can coexist as distinct URL-addressable pages without a heavy router dependency.
- Background: The app currently renders a single component (App.jsx) with no routing. The meeting view requires a `/meeting/:id` route. Hash routing (`#/meeting/1`) keeps the implementation to a single file and zero new runtime dependencies; the server's existing SPA fallback already serves `index.html` for all non-API paths, so history-API routing also works — use `location.hash` to avoid any server changes.
- Deliverables: A `Router` component (or routing logic in `main.jsx`) that dispatches to either the landing list (`BriefingList`) or the meeting view (`MeetingView`) based on the current URL hash, plus a link from each briefing row on the landing page to its meeting view.

## Requirements
- Goal / deliverables: Hash-based client-side routing; landing list links to `/meeting/:id` via `#/meeting/:id`; back-navigation from meeting view returns to landing list.
- MVP: Two routes — `#/` (or empty hash) → landing list; `#/meeting/:id` → meeting view. No external router package.
- Non-goals: History-API routing (leave as a future improvement); nested routes; animated transitions; query-string parsing.
- Acceptance criteria:
  1. Navigating to `/#/meeting/42` in the browser renders the `MeetingView` component, not the landing list.
  2. Navigating to `/#/` or `/#` or an empty hash renders the landing list.
  3. Each briefing row in the landing list has an anchor (`<a>`) whose `href` is `#/meeting/{id}` — clicking it routes to the meeting view without a full page reload.
  4. The meeting view renders a "Back" link (or button that sets `location.hash = '#/'`) that returns the user to the landing list.
  5. No router package is added to `client/package.json` dependencies.
  6. The routing logic lives in `client/src/Router.jsx` and is imported by `client/src/main.jsx`.
- Constraints / risks: Hash routing means the `id` is parsed from `location.hash` on every hashchange — keep parsing simple and defensive (parse failure → redirect to `#/`).

## Design

### Target Files
- Add:
  - `client/src/Router.jsx` - stateful component that reads `location.hash`, dispatches to `BriefingList` or `MeetingView`, re-renders on `hashchange`
- Update:
  - `client/src/main.jsx` - import and render `Router` instead of `App`
  - `client/src/App.jsx` - rename the default export to `BriefingList` (i.e. `export default function BriefingList()`) and add `href="#/meeting/{b.id}"` to each briefing `<li>`; `Router.jsx` imports it as `import BriefingList from './App.jsx'`

### Modules, Classes, And Functions
- Module: `client/src/Router.jsx` - top-level routing shell
  - Function: `Router()` — React component
  - Responsibility: Reads `location.hash` on mount and on `hashchange` event; parses the hash to determine which view to render; passes the parsed `id` to `MeetingView`; falls back to `BriefingList` on unrecognised paths.
  - Input/output: No props; renders either `<BriefingList />` or `<MeetingView id={id} />`.
  - Dependencies: `useState`, `useEffect` from React; `BriefingList` from `./App.jsx`; `MeetingView` from `./MeetingView.jsx`.

- Module: `client/src/App.jsx` (updated)
  - Function: `BriefingList()` — renamed/refactored from default export `App`; exported as `export default function BriefingList()`
  - Responsibility: Fetches and lists briefings; each row links to `#/meeting/{id}`.
  - Input/output: No props; renders the landing list with `<a href="#/meeting/{id}">` per row.
  - Import in Router.jsx: `import BriefingList from './App.jsx'` (default import).
  - Dependencies: `useState`, `useEffect` from React.

### Data Models
- No new data models. The router parses an integer `id` from the hash string (`#/meeting/42` → `id = 42`).

### Errors And Exceptions
- Error: hash does not match `#/meeting/:id` pattern — fall through to landing list render (no error thrown, no console warning).
- Error: `id` parsed from hash is not a valid integer — redirect to `#/` and render landing list.

## Test Cases
- Normal: hash `#/meeting/1` → `Router` renders `MeetingView` with `id=1`.
- Normal: hash `#/` → `Router` renders `BriefingList`.
- Normal: empty hash (`""`) → `Router` renders `BriefingList`.
- Boundary: hash `#/meeting/abc` (non-numeric id) → `Router` redirects to `#/` and renders `BriefingList`.
- Boundary: unrecognised hash `#/unknown` → `Router` renders `BriefingList`.
- Boundary: `hashchange` event fires after initial mount → `Router` re-renders with updated route.

## Verification
- Commands: `npm run build` in root passes with no errors; `cd client && npm run dev` starts without errors.
- Manual checks: Open `/#/meeting/1` in browser — landing list is NOT visible; open `/#/` — meeting view is NOT visible. Click a briefing link on the landing list — the URL hash changes and the meeting view appears.

## Completion Criteria
- All acceptance criteria met, test cases passing, implementation review passed,
  docs/ updated in this worktree to reflect the change.
