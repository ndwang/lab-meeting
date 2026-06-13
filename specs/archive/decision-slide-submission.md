# Decision Slide Submission — Client Wiring

<!-- Sprint 2 spec. Planner-authored. Revised after spec review round 1. -->

## Overview
- Purpose: Wire the decision slide so that clicking Approve or Redirect in the browser POSTs to
  `POST /api/minutes`, then shows a confirmation or error state. The directive for Approve is the
  slide's proposed next-steps text; for Redirect it is the human's typed text.
- Background: `useMeetingState` already captures `decision` in client state. `SlideStage` already
  renders `DecisionControls` which calls `onDecide(outcome, direction)`. Currently nothing persists
  to the server. This spec adds the server write and the post-decision UI states.
- Deliverables:
  - `MeetingView.jsx` updated to fire `POST /api/minutes` when the state machine records a decision.
  - `DecisionControls` in `SlideStage.jsx` updated so Approve passes the slide's `content` field
    as the directive.
  - `client/src/__tests__/MeetingView.test.jsx` updated: one existing test is superseded and
    replaced; new tests cover the submit happy path, error state, and retry.

## Requirements
- Goal / deliverables:
  - `client/src/MeetingView.jsx` — trigger the POST; render confirmation/error.
  - `client/src/SlideStage.jsx` — pass the slide's content as the default directive for Approve.
  - `client/src/__tests__/MeetingView.test.jsx` — update existing test file (do NOT create a new
    file at `client/src/MeetingView.test.jsx`).
- MVP:
  - On Approve: `directive` = decision slide's `content` bullets joined with `\n` (the proposed
    next-steps text embedded in the briefing). If `content` is empty, `directive` = `''` (still
    valid).
  - On Redirect: `directive` = the human's non-empty typed text (already enforced by the button's
    `disabled` state).
  - `answers` = array of `{ title, answer }` derived from `state.answers` (slide index → text)
    mapped against `briefing.slides`.
  - POST body: `{ briefingId: id, outcome, directive, answers }`.
  - On HTTP 201: render a full-screen confirmation `data-testid="minutes-confirmed"` and hide the
    slide stage.
  - On any non-201 response or network error: render an inline error `data-testid="minutes-error"`,
    show `data-testid="minutes-retry"` button to reset `submitStatus` so the human can re-click
    Approve or Redirect. The slide stage (including the decision controls) remains visible. The
    decision state (`state.decision`) is NOT cleared — `useMeetingState` has no `resetDecision()`
    API and this spec does NOT add one.
  - **Retry mechanism:** On error, `submitStatus` is set to `'error'`. A "Try again" button with
    `data-testid="minutes-retry"` resets `submitStatus` back to `null`. This makes the
    `DecisionControls` re-activatable: when the human clicks Approve or Redirect again, `decide()`
    is called (setting a new `decision` object) and the effect fires the POST again. The effect must
    guard against double-invoke using a ref tied to the current `state.decision` value (see Design).
  - Preserve the page-gated flow: the decision controls are visible when on the decision slide AND
    `submitStatus` is `null` (not yet submitted) or `'error'` (submission failed, retry allowed).
    The controls are hidden only when `submitStatus` is `'pending'` or `'confirmed'`.
- Non-goals: voice/TTS; any edit of the directive after submission; the Q&A endpoint; polling;
  `scripts/poll.mjs`.
- Acceptance criteria:
  1. When `useMeetingState.decide('approve', ...)` fires, `fetch` is called exactly once with
     `POST /api/minutes` and the correct body (briefingId, outcome='approve', directive from slide
     content, answers array).
  2. When `useMeetingState.decide('redirect', 'focus on X')` fires, `fetch` is called with
     `outcome='redirect'` and `directive='focus on X'`.
  3. On a 201 response, `data-testid="minutes-confirmed"` appears and the slide stage is gone.
  4. On a non-201 response, `data-testid="minutes-error"` appears and `data-testid="minutes-retry"`
     appears. The decision slide controls remain in the DOM (the decision state is NOT reset; the
     retry button resets `submitStatus` to `null` so the human can re-click).
  5. All existing `useMeetingState` tests still pass without modification.
  6. All existing `MeetingView` fetch tests (loading / error / ok states) still pass, EXCEPT the
     test named `'does not call any write endpoint (no POST)'` which is superseded and REPLACED
     (see below).
- Constraints / risks:
  - `MeetingView` currently does not receive `briefingId` as a prop — it must pass it down from the
    `id` prop already available in `MeetingView({ id })`.
  - The effect that fires the POST must be idempotent with respect to React StrictMode double-invoke;
    guard with a ref or state flag so the POST is sent exactly once per decision.
  - The `stateStub` in the existing test file has `decision: null`. New tests that exercise the POST
    path must supply a different stub where `decision` is non-null.

## Design

### Target Files
- Update:
  - `client/src/MeetingView.jsx` - add decision effect, confirmation state, error state
  - `client/src/SlideStage.jsx` - pass `slide.content` as default directive to Approve path
  - `client/src/__tests__/MeetingView.test.jsx` - replace superseded test; add new submit tests

### Superseded Test
The existing test at line 153–167 of `client/src/__tests__/MeetingView.test.jsx`:

```
it('does not call any write endpoint (no POST)', ...)
```

This test directly contradicts the new behavior (the component WILL POST to `/api/minutes` when
`state.decision` is non-null). The builder must DELETE this test and REPLACE it with a test that
verifies the inverse: that when `state.decision` IS null (the default `stateStub`), no POST to
`/api/minutes` is made. The replacement test name should be:
`'does not POST /api/minutes when decision is null'`.

The builder must also add the new submit/confirmation/error tests listed in the Test Cases section
below.

### Modules, Classes, And Functions
- Module: `client/src/MeetingView.jsx`
  - Component: `Meeting({ briefing, briefingId })`
    - Responsibility: Owns the effect that watches `state.decision` and fires `POST /api/minutes`.
    - Input: `briefing` (the JSON from the server), `briefingId` (integer, passed from parent)
    - Output: Renders `SlideStage` or `<ConfirmedState>` or `<SubmitError onRetry=... />`
    - State: `submitStatus: null | 'pending' | 'confirmed' | 'error'`
    - Effect logic:
      - Watch `state.decision`. When it becomes non-null AND `submitStatus` is `null`,
        set `submitStatus = 'pending'` and fire `POST /api/minutes`.
      - Guard against React StrictMode double-invoke: use a ref (`submitted`) that is set to
        `true` before the fetch and checked at the start of the effect; reset it to `false` on
        cleanup. This ensures exactly one POST per decision-state transition.
      - On 201: set `submitStatus = 'confirmed'`.
      - On any failure (non-201 or network error): set `submitStatus = 'error'`.
        Do NOT attempt to reset `state.decision` — no such API exists. The retry flow is handled
        entirely through `submitStatus`.
    - Retry flow: `<SubmitError>` renders a `data-testid="minutes-retry"` button whose `onClick`
      calls `setSubmitStatus(null)`. This brings `submitStatus` back to `null`, re-enabling the
      decision controls. When the human clicks Approve or Redirect again, `decide()` is called
      (setting a new decision object reference), the effect re-fires, and the POST is sent again.
    - Decision controls visibility: The `SlideStage` (and its `DecisionControls`) is rendered when
      `submitStatus !== 'confirmed'`. It is always visible on error (so the human can re-click
      after pressing "Try again").
  - Component: `ConfirmedState()`
    - Responsibility: Render the post-decision confirmation screen.
    - Output: `<div data-testid="minutes-confirmed">Minutes recorded · next sprint queued</div>`
  - Component: `SubmitError({ onRetry })`
    - Responsibility: Render an inline error banner with a retry button.
    - Output:
      ```jsx
      <div data-testid="minutes-error">
        Failed to record minutes. <button data-testid="minutes-retry" onClick={onRetry}>Try again</button>
      </div>
      ```

- Module: `client/src/SlideStage.jsx`
  - Component: `DecisionControls({ onDecide, slide })`
    - Responsibility: Approve uses `slide.content` bullets joined with `\n` as the directive;
      Redirect uses the typed textarea value.
    - Change: Accept `slide` prop; compute `approveDirective = (slide?.content ?? []).join('\n')`.
    - The parent `SlideStage` must pass `slide={slide}` to `DecisionControls`.

- Module: `client/src/__tests__/MeetingView.test.jsx`
  - The existing `stateStub` has `decision: null`. New describe blocks for submit tests should
    use a separate stub where `decision` is set to a non-null value to trigger the effect.
  - Tests use `vi.spyOn(global, 'fetch')` or `global.fetch = vi.fn(...)` — consistent with
    existing test style.

### Data Models
- POST body shape:
  ```js
  {
    briefingId: number,         // integer id of the briefing
    outcome: 'approve'|'redirect',
    directive: string,          // non-empty for redirect; slide content joined for approve
    answers: Array<{ title: string, answer: string }>  // may be empty []
  }
  ```
- `answers` is assembled from `state.answers` (Record<slideIndex, answerText>) and
  `briefing.slides`: `Object.entries(state.answers).map(([i, answer]) => ({ title: briefing.slides[i]?.title ?? '', answer }))`.

### Errors And Exceptions
- Error: network failure or non-201 status → set `submitStatus='error'`. Do NOT reset
  `state.decision`. Show `data-testid="minutes-error"` and `data-testid="minutes-retry"` button.
- Error: double-invoke (React StrictMode) → guard with a `submitted` ref; only the first effect
  execution sends the POST.

## Test Cases
- New tests to ADD to `client/src/__tests__/MeetingView.test.jsx`:
  - Render a briefing with `[info, decision]`; use a stub with `decision={ outcome:'approve', direction:'' }`;
    mock fetch returns 201 → `minutes-confirmed` visible; fetch called once with correct body.
  - Same flow but `decision={ outcome:'redirect', direction:'focus on X' }` → fetch called with
    `outcome='redirect'` and `directive='focus on X'`.
  - `state.answers` populated → answers array included in POST body.
  - Mock fetch returns 400 → `minutes-error` visible; `minutes-retry` visible; slide stage present.
  - Mock fetch rejects (network error) → `minutes-error` visible.
  - Decision slide with empty `content` → Approve sends `directive: ''`; still posts.
  - No question slides → `answers: []` in body.
- Test to REPLACE (delete old, add new):
  - OLD (delete): `'does not call any write endpoint (no POST)'` — asserts no POST at all.
  - NEW (add): `'does not POST /api/minutes when decision is null'` — same setup with
    `stateStub.decision = null`; asserts no call to `/api/minutes` appears in fetch mock calls.
- Existing tests that MUST PASS unchanged:
  - `'shows a loading indicator while the briefing is fetching'`
  - `'fetches GET /api/briefings/{id} on mount'`
  - `'renders the sprint header and SlideStage on success'`
  - `'passes the briefing slides and state callbacks to SlideStage'`
  - `'renders an error state with "not found" on a 404'`
  - `'renders an error state on a network failure'`
  - `'renders an error state when the briefing has no slides array'`
  - `'renders SlideStage with no crash when slides is an empty array'`
  - `'re-fetches when the id prop changes'`

## Verification
- Commands: `cd client && npx vitest run src/__tests__/MeetingView.test.jsx`
- Manual checks: Open a briefing ending with a decision slide, click Redirect with typed text,
  confirm the confirmation banner appears; open the DB and verify the minutes + sprint_queue rows.

## Completion Criteria
- All acceptance criteria met, test cases passing, implementation review passed,
  docs/ updated in this worktree to reflect the change.
