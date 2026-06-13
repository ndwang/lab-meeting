# Decision Slide Two-Step Client Flow

## Overview
- Purpose: Replace the single-step decision flow (click → POST /api/minutes → confirmed) with a
  visible two-step flow: Step 1 — human submits their direction → POST /api/minutes → poll until
  composed; Step 2 — composed instruction shown in an editable textarea → human clicks
  "Approve & launch" → POST /api/minutes/:id/approve → "Next sprint queued".
- Background: The composed-instruction-then-approve beat is the product's central value proposition
  — the human sees exactly what the agent will do before it launches. This must be prominent and
  clear, never collapsed or auto-dismissed.
- Deliverables: Updated `MeetingView.jsx` (two-step submit state machine), updated `SlideStage.jsx`
  (DecisionControls API unchanged; ConfirmedState text update if it lives there), completely
  replaced `MeetingView.test.jsx` minutes-submission tests (all 8 tests in the
  `'MeetingView — minutes submission'` describe block are deleted and replaced with new tests
  covering the two-step flow), and updated `SlideStage.test.jsx` (any assertions that relied on
  the old auto-enqueue confirmation path, updated).

## Requirements
- Goal / deliverables: All changes in `client/src/MeetingView.jsx`, `client/src/SlideStage.jsx`
  (if needed), `client/src/__tests__/MeetingView.test.jsx`,
  `client/src/__tests__/SlideStage.test.jsx`.
- MVP:
  - Step 1 (submit direction): when `state.decision` is set, POST `{ briefingId, outcome, directive,
    answers }` to `/api/minutes`. On 201 response, extract `minutesId` from the response body,
    enter `'composing'` state: show a "Composing the next instruction…" message and start polling
    `GET /api/minutes?briefingId=N` every 2 seconds until the returned first row's `status` is
    `'composed'`. When `status='composed'` is returned, seed `approveGoal` from that row's
    `composedGoal` and advance to the compose-review state.
  - Step 2 (approve): render the composed instruction in an editable textarea labeled
    "Here's what I'll work on next" (`aria-label="Next sprint goal"`, pre-filled with `composedGoal`
    seeded from the poll response), plus an "Approve & launch" button. On click, POST
    `{ goal: approveGoal }` to `/api/minutes/:minutesId/approve`. On 201, show the final confirmed
    state: "Next sprint queued".
  - Handle errors at both steps: show an error message with a retry button; preserve the slide stage.
  - The polling loop must be cleaned up on component unmount.
- Non-goals: Voice/TTS; any server-side changes; poll interval configuration; any changes to
  `useMeetingState.js` or `QAPanel.jsx` or `Router.jsx`.
- Acceptance criteria:
  1. After `state.decision` is set, exactly one POST to `/api/minutes` is made (guarded against
     double-invoke as before with `submitted` ref). The POST response body `{ minutesId }` is
     stored in component state for use in the Step 2 approve URL.
  2. While waiting for `status='composed'`, a `data-testid="composing"` element is visible and
     the slide stage is hidden.
  3. Once the poll returns a first row with `status='composed'`, a `data-testid="compose-review"`
     section is visible containing: a textarea (`aria-label="Next sprint goal"`) pre-filled with
     `composedGoal` from the poll response row, and a button labeled "Approve & launch". The
     `approveGoal` state is initialised from `composedGoal` at the moment the poll resolves.
  4. Editing the textarea and clicking "Approve & launch" POSTs
     `{ goal: <edited value> }` to `/api/minutes/:minutesId/approve`.
  5. On a 201 approve response, `data-testid="minutes-confirmed"` is shown with text
     "Next sprint queued" and the compose-review section is hidden.
  6. If POST /api/minutes fails (non-201 or network error), `data-testid="minutes-error"` is shown
     with a retry button (`data-testid="minutes-retry"`); clicking retry re-sends the POST.
  7. If POST /api/minutes/:id/approve fails (non-201 or network error), `data-testid="approve-error"`
     is shown with a retry button (`data-testid="approve-retry"`); clicking retry re-sends the
     approve POST.
  8. All existing `SlideStage` tests pass — the DecisionControls Approve/Redirect buttons still
     call `onDecide` with the same arguments as before; the SlideStage API is unchanged.
  9. All existing briefing-loading tests in `MeetingView.test.jsx` (the `'MeetingView'` describe
     block, 9 tests) pass unmodified.
  10. The polling interval is cleared on component unmount to avoid state updates after unmount.
- Constraints / risks:
  - The polling loop must use `setInterval` (or equivalent) and must be cancelled via the effect's
    cleanup function to avoid state updates on unmounted components.
  - Poll interval is 2000 ms (hardcoded; not configurable via props or env).
  - MeetingView's `submitStatus` state machine expands to cover the new states. Use a string enum:
    `null | 'pending' | 'composing' | 'composed' | 'approving' | 'approved' | 'submit-error' | 'approve-error'`.
  - `SlideStage.jsx` / `DecisionControls` are unchanged in terms of API: they still call
    `onDecide(outcome, direction)`. The old `ConfirmedState` message text changes from
    "Minutes recorded · next sprint queued" to "Next sprint queued".
  - The entire `'MeetingView — minutes submission'` describe block (all 8 tests) must be deleted
    and replaced. These tests call `await screen.findByTestId('minutes-confirmed')` immediately
    after POST /api/minutes returns 201, which is incompatible with the new two-step flow. None
    of them can be kept or lightly modified — they must be fully rewritten as new tests that
    exercise the two-step flow with polling.

## Design

### Target Files
- Update:
  - `client/src/MeetingView.jsx` - two-step submit state machine; composing poll; compose-review
    UI; approve call; updated confirmation text
  - `client/src/SlideStage.jsx` - no logic changes; only update the `ConfirmedState` text if it
    lives here (it does not — ConfirmedState is in MeetingView.jsx, so SlideStage.jsx may be
    unchanged unless its tests require an update)
  - `client/src/__tests__/MeetingView.test.jsx` - delete the entire `'MeetingView — minutes
    submission'` describe block (8 tests) and replace with new describe block covering the
    two-step flow; keep the `'MeetingView'` describe block (9 tests) intact
  - `client/src/__tests__/SlideStage.test.jsx` - update if any assertion relied on the old single-
    step confirmation; otherwise existing tests must continue to pass as-is

### Modules, Classes, And Functions
- Module: `client/src/MeetingView.jsx`
  - Component: `Meeting` (updated)
    - New state: `submitStatus` (string enum, see constraints above); `minutesId` (integer, stored
      after POST /api/minutes returns 201); `composedRow` (object `{ composedGoal, composedMinutes }`
      or null); `approveGoal` (string, the possibly-edited goal in the textarea, seeded from
      `composedRow.composedGoal` when the poll first returns `status='composed'`).
    - Effect 1 (existing, updated): when `state.decision` is set and `submitStatus` is null, POST
      `/api/minutes`; on 201 extract `minutesId` from response JSON and set `minutesId` +
      `submitStatus='composing'`; on error set `submitStatus='submit-error'`.
    - Effect 2 (new): when `submitStatus === 'composing'`, start a `setInterval` polling
      `GET /api/minutes?briefingId=N` every 2000ms; when the first row's `status === 'composed'`,
      set `composedRow = { composedGoal: row.composedGoal, composedMinutes: row.composedMinutes }`,
      set `approveGoal = row.composedGoal`, and set `submitStatus='composed'`; clear the interval
      in the cleanup function. Non-ok poll responses are silently ignored (transient errors keep
      the interval running).
    - Handler `handleApprove`: POST `{ goal: approveGoal }` to `/api/minutes/${minutesId}/approve`;
      on 201 set `submitStatus='approved'`; on error set `submitStatus='approve-error'`.
  - Component: `ComposingState` (new) — renders the "Composing the next instruction…" message
    with `data-testid="composing"`.
  - Component: `ComposeReview` (new) — renders `data-testid="compose-review"`, a labeled textarea
    (`aria-label="Next sprint goal"`), and "Approve & launch" button.
  - Component: `ConfirmedState` (updated) — text becomes "Next sprint queued";
    `data-testid="minutes-confirmed"` unchanged.
  - Component: `ApproveError` (new) — renders an approve-error message + retry button with
    `data-testid="approve-error"` and `data-testid="approve-retry"`.
  - Component: `SubmitError` (existing, unchanged logic) — `data-testid="minutes-error"` and
    `data-testid="minutes-retry"`.

### Data Models
No new data models. The component reads `composedGoal` and `composedMinutes` from the
`GET /api/minutes?briefingId=N` response row.

### Errors And Exceptions
- Error: POST /api/minutes non-201 or network error → `submitStatus='submit-error'`; show
  SubmitError with retry; retry resets `submitStatus` to null and clears the `submitted` ref.
- Error: POST /api/minutes/:id/approve non-201 or network error → `submitStatus='approve-error'`;
  show ApproveError with retry; retry re-calls `handleApprove`.
- Error: poll GET /api/minutes returns a non-ok response → keep polling (transient errors are
  ignored; the interval continues until status='composed' or component unmounts).

## Test Cases

### Helper: `mockBriefingAndMinutes`
The existing helper must be fully replaced. The new helper signature is:

```js
function mockBriefingAndMinutes({
  briefing,
  postStatus = 201,       // HTTP status for POST /api/minutes
  postThrows = false,     // make POST /api/minutes throw a network error
  pollRows = null,        // array of { status, composedGoal, composedMinutes } objects returned
                          // by successive GET /api/minutes?briefingId=N calls. If null, no poll
                          // mock is set up. Each call consumes the next element; last element
                          // is repeated for any further calls.
  approveStatus = 201,    // HTTP status for POST /api/minutes/:id/approve
  approveThrows = false,  // make POST /api/minutes/:id/approve throw
} = {})
```

The helper must use `vi.useFakeTimers()` internally (called at the start of the helper) so that
polling can be driven forward with `vi.advanceTimersByTimeAsync(2000)` in the test body. Tests
that use `mockBriefingAndMinutes` must call `vi.useRealTimers()` in their cleanup (or in
`afterEach`). POST /api/minutes returning 201 must include a JSON body `{ minutesId: 11 }`.

Example fetch mock implementation inside the helper:
```js
global.fetch = vi.fn(async (url, opts) => {
  if (opts?.method === 'POST' && url === '/api/minutes') {
    if (postThrows) throw new Error('network down');
    return { ok: postStatus === 201, status: postStatus,
             json: async () => ({ minutesId: 11 }) };
  }
  if (url.startsWith('/api/minutes?briefingId=')) {
    const row = pollRows[Math.min(callCount++, pollRows.length - 1)];
    return { ok: true, json: async () => [row] };
  }
  if (opts?.method === 'POST' && url.match(/\/api\/minutes\/\d+\/approve/)) {
    if (approveThrows) throw new Error('network down');
    return { ok: approveStatus === 201, status: approveStatus,
             json: async () => ({ queuedSprintId: 22 }) };
  }
  // briefing GET
  return { ok: true, json: async () => briefing };
});
```

Note: Tests that drive polling must call `vi.advanceTimersByTimeAsync(2000)` after rendering
to trigger the first poll tick. Tests that only care about Step 1 (composing state) do not need
to advance timers.

### Test cases
- Normal:
  - Decision set → POST /api/minutes called once with correct body; `data-testid="composing"`
    appears; poll `GET /api/minutes?briefingId=N` has not yet been called (pre-tick).
  - After timer advances 2000ms and poll returns `{ status: 'composed', composedGoal: 'goal', composedMinutes: '...' }` →
    `data-testid="compose-review"` appears; textarea value is 'goal'; slide stage hidden.
  - User edits goal textarea → "Approve & launch" POSTs `{ goal: <edited value> }`.
  - User does not edit textarea → "Approve & launch" POSTs the original `composedGoal` (because
    `approveGoal` is seeded from `composedRow.composedGoal` when compose-review is entered).
  - Approve POST returns 201 → `data-testid="minutes-confirmed"` with text "Next sprint queued";
    `data-testid="compose-review"` is not rendered.
  - POST /api/minutes body shape correct: `{ briefingId, outcome, directive, answers }`.
- Error:
  - POST /api/minutes non-201 → `data-testid="minutes-error"` shown; `data-testid="slide-stage"`
    still present; clicking `data-testid="minutes-retry"` re-sends the POST.
  - POST /api/minutes network error → `data-testid="minutes-error"` shown.
  - POST /api/minutes/:id/approve non-201 → `data-testid="approve-error"` shown; retry re-sends.
- Boundary:
  - Poll returns row with `status='resolved'` (not yet composed) → stays in `data-testid="composing"`
    state; advance timer again → still composing (no advance until status='composed').
  - Component unmounts while polling → interval is cleared (no crash, no state update after unmount).
    Test: render, advance timer to start polling, unmount, confirm no console error.
  - All existing SlideStage tests pass (Approve/Redirect still call `onDecide` with same args).
  - All 9 existing briefing-loading and wiring tests in the `'MeetingView'` describe block pass
    unmodified.

## Verification
- Commands: `cd client && npx vitest run`
- Manual checks: Open a meeting, reach the decision slide, submit a redirect, watch the
  "Composing…" state appear, mock or wait for the compose endpoint to populate the row, confirm
  the editable textarea appears, approve, confirm "Next sprint queued" appears.

## Completion Criteria
- All acceptance criteria met, test cases passing, implementation review passed,
  docs/ updated in this worktree to reflect the change.
