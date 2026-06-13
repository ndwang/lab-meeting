# QA Client UI

## Overview
- Purpose: Add the live Q&A panel to `MeetingView.jsx` — a follow-up question input box, optimistic pending state, a polling loop that detects when the daemon has answered, and a rendered Q&A thread — all as an aside that does not disrupt the page-gated slide flow.
- Background: During a briefing the human may want to ask grounded follow-up questions. The browser posts the question, then polls `GET /api/qa?briefingId=N` until the answer appears. The host agent (daemon-side, out of scope) answers; the client only needs to post and poll.
- Deliverables: New `QAPanel` component rendered alongside `SlideStage` inside the `Meeting` component in `MeetingView.jsx`; a `useQA` custom hook (or inline state) managing the lifecycle; a new test file `client/src/QAPanel.test.jsx`.

## Requirements
- Goal / deliverables: `QAPanel` component and test file; `MeetingView.jsx` updated to render the panel; existing tests unchanged.
- MVP: Human can type a question, submit it (POST /api/qa), see a pending state, and — once the daemon answers — see the answer rendered in the thread attributed to "Claude — Engineer".
- Non-goals: No voice/speech input. No WebSocket or SSE — polling only. No token auth on browser side (server has no token requirement for POST /api/qa or GET /api/qa). Do not alter slide-gating logic in `useMeetingState`.
- Acceptance criteria:
  - A textarea + submit button labeled "Ask a follow-up" is visible during the meeting (whenever the `Meeting` component renders, regardless of current slide index).
  - Submitting a non-empty question calls `POST /api/qa` with body `{ briefingId, question }` and disables the submit button while in flight.
  - After a successful POST the question appears in the thread with label "You" and a status indicator showing "pending — bringing in the engineer…".
  - The component begins polling `GET /api/qa?briefingId=N` at a regular interval (no faster than 3 seconds) after any question is submitted; polling stops when all displayed questions are answered or when the component unmounts.
  - When the poll response shows a question with `status === 'answered'`, its answer is rendered below the question, attributed with the label "Claude — Engineer".
  - All previously answered Q&A pairs persist in the thread (the full thread is re-rendered on each poll response).
  - If `POST /api/qa` fails (network error or non-2xx), the component shows an inline error message and re-enables the form.
  - The slide stage and all existing slide-gating behaviour (continue / answer / decide) remain unaffected.
  - The textarea clears after a successful POST.
- Constraints / risks: Polling must use `clearInterval` on component unmount to avoid memory leaks. Do not introduce dependencies beyond what is already in `client/package.json`.

## Design

### Target Files
- Update:
  - `client/src/MeetingView.jsx` - render `QAPanel` inside `Meeting` component
- Add:
  - `client/src/QAPanel.jsx` - self-contained Q&A panel component
  - `client/src/QAPanel.test.jsx` - vitest + testing-library tests

### Modules, Classes, And Functions
- Module: `client/src/QAPanel.jsx` - Q&A aside panel
  - Component: `QAPanel({ briefingId })` - renders the full Q&A panel
    - Input props: `briefingId` (number or string — the briefing's id)
    - Output: JSX — textarea, submit button, thread of question/answer pairs
    - Internal state: `question` (controlled textarea), `thread` (array of `{ id, question, answer, status }`), `submitStatus` ('idle' | 'pending' | 'error'), `pollError` (boolean)
    - Side effects: `POST /api/qa` on submit; `setInterval` polling `GET /api/qa?briefingId=N`; `clearInterval` on unmount and when all answered
    - Dependencies: browser fetch API only

### Data Models
- Model: thread item (local state, mirrors server row shape)
  - Fields:
    - `id: number` - question id returned by POST /api/qa
    - `question: string` - question text
    - `answer: string | null` - null until answered
    - `status: 'pending' | 'claimed' | 'answered'`
    - `created_at: string` - ISO timestamp from server

### Errors And Exceptions
- Error: POST /api/qa network failure or non-2xx → show inline error, re-enable form, do not add to thread
- Error: GET /api/qa poll failure → silent (do not crash the panel; keep polling)

## Test Cases
- Normal:
  - Submitting a question calls fetch with `POST /api/qa` and the correct body `{ briefingId, question }`.
  - After a successful POST the question appears in the thread with "You" label and pending state text.
  - When the poll response includes an answered question, the answer is rendered with "Claude — Engineer" label.
  - Textarea is cleared after successful submit.
- Error:
  - When POST /api/qa returns a non-2xx status, an error message is shown and the form is re-enabled.
- Boundary:
  - Submit button is disabled when the textarea is empty.
  - SlideStage continues to render and the existing slide controls are not affected by `QAPanel` presence.
  - Polling interval is cleared when all questions in the thread reach `status === 'answered'`, and no further fetch calls are made after that point.

## Verification
- Commands: `cd client && npm test` (runs all vitest tests including QAPanel.test.jsx and useMeetingState.test.js).
- Manual checks: Open a meeting, type a question, submit, see "pending — bringing in the engineer…"; observe the thread update when the server row is answered (testable by directly PATCHing/POSTing the answer via the API).

## Completion Criteria
- All acceptance criteria met, test cases passing, implementation review passed, docs/ updated in this worktree to reflect the change.
