# Meeting View Page

<!-- One spec per work item. Written by the planner, reviewed in batch by the spec reviewer,
     implemented by one builder in an isolated worktree. -->

## Overview
- Purpose: Create the `MeetingView` page component that fetches a briefing by id from `GET /api/briefings/:id` and passes it to the slide stage for rendering. This component owns the top-level data fetch, error/loading states, and the meeting-level chrome (sprint name, goal line).
- Background: `GET /api/briefings/:id` already exists in `server/src/app.js` and returns the full briefing payload (the same schema as `briefings/sprint-1.json`). The meeting view needs to surface the structured slide data to the slide stage component and the page-gating state machine. The slide stage (`SlideStage`) and gating logic (`useMeetingState`) are built by separate work items; this item wires them together.
- Deliverables: `client/src/MeetingView.jsx` — a React component that fetches the briefing, shows loading/error states, and renders the slide stage.

## Requirements
- Goal / deliverables: A page component reachable from the router at `#/meeting/:id` that fetches `GET /api/briefings/:id` and renders the meeting.
- MVP: Fetch briefing on mount; show loading spinner or "Loading…" text while fetching; show a clear error message on 404 or network failure; on success render `<SlideStage>` with the briefing slides.
- Non-goals: Polling / auto-refresh after load; persisting answers to the server; any POST calls; voice/TTS; avatar tiles.
- Acceptance criteria:
  1. `MeetingView` accepts a single prop `id` (number or string) and on mount fetches `GET /api/briefings/{id}`.
  2. While fetching, the component renders a loading indicator (`data-testid="loading"`).
  3. On a 404 or network error, the component renders an error message containing the text "not found" or "error" (`data-testid="error"`).
  4. On success the component calls `useMeetingState(briefing.slides)` and renders `<SlideStage slides={briefing.slides} currentIndex={state.currentIndex} answers={state.answers} onContinue={state.continue} onAnswer={state.answer} onDecide={state.decide} />` (the `SlideStage` component from `./SlideStage.jsx`; `state` is the return value of `useMeetingState(briefing.slides)`).
  5. The meeting-level header renders the `sprintId` and `goal` from the briefing above the slide stage.
  6. The component does NOT call `POST /api/minutes` or any write endpoint.
- Constraints / risks: `fetch` is available natively; no axios or other fetch libraries. The briefing payload returned by the server is `row.payload ?? row` — the shape matches the JSON schema in CLAUDE.md exactly.

## Design

### Target Files
- Add:
  - `client/src/MeetingView.jsx` - page component: fetch briefing, handle loading/error, render SlideStage

### Modules, Classes, And Functions
- Module: `client/src/MeetingView.jsx` - meeting page
  - Function: `MeetingView({ id })` — React component
  - Responsibility: On mount, fetch `GET /api/briefings/{id}`; manage `status` state (`'loading' | 'error' | 'ok'`); on success, call `useMeetingState(briefing.slides)` to obtain the page-gating state and action callbacks, then render the sprint header and `<SlideStage>` with all six props wired up.
  - Wiring: `const state = useMeetingState(briefing.slides)` — pass `slides={briefing.slides}`, `currentIndex={state.currentIndex}`, `answers={state.answers}`, `onContinue={state.continue}`, `onAnswer={state.answer}`, `onDecide={state.decide}` to `<SlideStage>`.
  - Input/output: Props: `{ id: string | number }`. Renders loading placeholder, error message, or the meeting layout.
  - Dependencies: `useState`, `useEffect` from React; `SlideStage` from `./SlideStage.jsx`; `useMeetingState` from `./useMeetingState.js`.

### Data Models
- Model: `Briefing` - the full briefing object fetched from the server
  - Fields:
    - `sprintId: string` - sprint identifier shown in the meeting header
    - `goal: string` - sprint goal shown as a subtitle
    - `slides: Slide[]` - array of slides passed directly to SlideStage
    - `artifacts: object` - not rendered; present in payload but ignored by this component
  - Validation: If `slides` is missing or not an array, treat as a fetch error and render the error state.

### Errors And Exceptions
- Error: HTTP response status is not 2xx — render error state with `data-testid="error"`.
- Error: Response body cannot be parsed as JSON — render error state.
- Error: Parsed briefing has no `slides` array — render error state.
- Error: `id` prop changes after mount — re-fetch (add `id` to the `useEffect` dependency array).

## Test Cases
- Normal: `GET /api/briefings/1` returns sprint-1.json payload → renders sprint header (sprintId, goal) and `<SlideStage>`.
- Normal: While fetching → renders element with `data-testid="loading"`.
- Error: Server returns 404 → renders element with `data-testid="error"` containing "not found".
- Error: Network failure → renders element with `data-testid="error"`.
- Boundary: `slides` array is empty → renders `<SlideStage slides={[]} />` with no crash.
- Boundary: `id` prop changes → re-fetches and re-renders correctly.

## Verification
- Commands: `cd client && npx vitest run` passes; `npm run build` passes.
- Manual checks: Navigate to `/#/meeting/1` (with a live server and sprint-1.json seeded) — see loading flash, then sprint header + slide stage; navigate to `/#/meeting/9999` — see error message.

## Completion Criteria
- All acceptance criteria met, test cases passing, implementation review passed,
  docs/ updated in this worktree to reflect the change.
