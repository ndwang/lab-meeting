# Meeting State Machine

<!-- One spec per work item. Written by the planner, reviewed in batch by the spec reviewer,
     implemented by one builder in an isolated worktree. -->

## Overview
- Purpose: Implement the page-gating state machine as a custom React hook (`useMeetingState`) that drives slide progression based on slide type, enforces per-type gate rules, and accumulates answers and the final decision outcome in client state.
- Background: The meeting view is page-gated: `info` slides advance freely (via a "Continue" action); `question` slides are hard-gated until a non-empty answer is supplied; the `decision` slide is terminal and resolves with either `'approve'` or `'redirect'`. All captured data lives in client state only (no server writes in this sprint). The `SlideStage` component renders controls but delegates gate logic entirely to this hook.
- Deliverables: `client/src/useMeetingState.js` — a custom hook that accepts a `slides` array and exposes the current index, accumulated answers, decision outcome, and action callbacks.

## Requirements
- Goal / deliverables: A hook that enforces per-type gate rules and returns all state needed by `SlideStage` and `MeetingView`.
- MVP:
  - Tracks `currentIndex` (starts at 0).
  - Tracks `answers`: a plain object mapping slide index to answer text (for `question` slides).
  - Tracks `decision`: `null` until the `decision` slide is resolved, then `{ outcome: 'approve' | 'redirect', direction: string }`.
  - `continue()` — advances from `info` slides. No-op if the current slide is not `info`.
  - `answer(text)` — records the answer for the current `question` slide and advances. No-op if the current slide is not `question` or text is empty/whitespace.
  - `decide(outcome, direction)` — records the decision for the `decision` slide; does NOT advance `currentIndex` (the decision slide is terminal). No-op if not on the `decision` slide.
  - Advancing past the last non-decision slide is a no-op (index is clamped).
- Non-goals: Persistence to server; going backwards through slides; slide pre-loading; any async behaviour.
- Acceptance criteria:
  1. `useMeetingState(slides)` returns `{ currentIndex, answers, decision, continue: continueFn, answer: answerFn, decide: decideFn }`.
  2. Calling `continueFn()` on an `info` slide increments `currentIndex` by 1.
  3. Calling `continueFn()` on a `question` or `decision` slide is a no-op (index unchanged).
  4. Calling `answerFn('some text')` on a `question` slide records `answers[currentIndex] = 'some text'` and increments `currentIndex` by 1.
  5. Calling `answerFn('')` or `answerFn('   ')` on a `question` slide is a no-op (no recording, no advance).
  6. Calling `decideFn('approve', '')` on a `decision` slide sets `decision = { outcome: 'approve', direction: '' }` and does NOT change `currentIndex`.
  7. Calling `decideFn('redirect', 'focus on X')` sets `decision = { outcome: 'redirect', direction: 'focus on X' }`.
  8. Advancing from the last slide in the array is clamped — `currentIndex` does not exceed `slides.length - 1`.
  9. The hook is a pure function of its inputs and React state — no side effects, no fetch, no storage writes.
- Constraints / risks: The hook must work without a DOM (testable with `renderHook` from `@testing-library/react`). Action callback names avoid conflict with JS reserved words: use `continueFn` or similar internally, but the returned object key MUST be named `continue` (quoted or accessed as a property).

## Design

### Target Files
- Add:
  - `client/src/useMeetingState.js` - custom hook implementing the meeting state machine

### Modules, Classes, And Functions
- Module: `client/src/useMeetingState.js` - meeting state machine hook
  - Function: `useMeetingState(slides)` — custom React hook
  - Responsibility: Manages `currentIndex`, `answers`, and `decision` via `useState`; exposes three action callbacks; enforces gate rules per slide type.
  - Input/output: `slides: Slide[]` → `{ currentIndex: number, answers: Record<number, string>, decision: null | { outcome: string, direction: string }, continue: () => void, answer: (text: string) => void, decide: (outcome: string, direction: string) => void }`.
  - Dependencies: `useState` from React only.

### Data Models
- Model: `MeetingState` - the object returned by the hook
  - Fields:
    - `currentIndex: number` - 0-based index of the currently displayed slide
    - `answers: Record<number, string>` - maps slide index to the text answer submitted for that slide
    - `decision: null | { outcome: 'approve' | 'redirect', direction: string }` - null until the decision slide is resolved
    - `continue: () => void` - advance from info slides
    - `answer: (text: string) => void` - record answer and advance from question slides
    - `decide: (outcome: string, direction: string) => void` - resolve the decision slide
  - Validation: All gate rules validated inside action callbacks; invalid calls silently no-op.

### Errors And Exceptions
- Error: `slides` is empty or undefined — return `currentIndex=0`, empty `answers`, `decision=null`, all action callbacks are no-ops.
- Error: `currentIndex` out of bounds when action is called — action is a no-op.

## Test Cases
- Normal: `slides = [info, question, info, decision]` — `continue()` on index 0 → index becomes 1.
- Normal: `answer('text')` on index 1 (`question`) → `answers[1] = 'text'`, index becomes 2.
- Normal: `continue()` on index 2 (`info`) → index becomes 3.
- Normal: `decide('approve', '')` on index 3 (`decision`) → `decision.outcome === 'approve'`, index stays 3.
- Gate: `continue()` on a `question` slide → index unchanged.
- Gate: `answer('')` or `answer('   ')` on a `question` slide → no change.
- Gate: `answer('x')` on an `info` slide → no change.
- Gate: `decide(...)` on an `info` slide → no change.
- Boundary: calling `continue()` when already at the last slide → `currentIndex` stays at `slides.length - 1`.
- Boundary: `slides = []` → all actions are no-ops, no crash.
- Regression: answers for different question slides are stored independently by index.
- Regression: `decide('redirect', 'focus on X')` stores `direction = 'focus on X'` correctly.

## Verification
- Commands: `cd client && npx vitest run` passes all `useMeetingState` tests (using `renderHook`).
- Manual checks: Walk through sprint-1.json in the browser — answers are captured, decision slide does not advance, Approve/Redirect updates state.

## Completion Criteria
- All acceptance criteria met, test cases passing, implementation review passed,
  docs/ updated in this worktree to reflect the change.
